import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'communications_localization.dart';
import 'communications_workspace.dart';
import 'patient_messages_localization.dart';

bool patientCareConversationEligibleStatus(dynamic status) =>
    status == 'CONFIRMED' || status == 'COMPLETED';

class PatientMessagesEntryButton extends StatefulWidget {
  const PatientMessagesEntryButton({super.key, required this.session, required this.locale});

  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientMessagesEntryButton> createState() => _PatientMessagesEntryButtonState();
}

class _PatientMessagesEntryButtonState extends State<PatientMessagesEntryButton> {
  bool loading = true;
  bool opening = false;
  List<Map<String, dynamic>> unread = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant PatientMessagesEntryButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.session != widget.session) _load();
  }

  bool _secureConversationEvent(Map<String, dynamic> row) =>
      row['type'] == 'SECURE_MESSAGE' &&
      row['entityType'] == 'CARE_CONVERSATION' &&
      (row['entityId']?.toString().trim().isNotEmpty ?? false);

  Future<void> _load() async {
    if (widget.session.account['role'] != 'PATIENT') {
      if (mounted) setState(() { loading = false; unread = const []; });
      return;
    }
    try {
      final rows = await widget.session.api.notifications().timeout(const Duration(seconds: 30));
      if (!mounted) return;
      setState(() {
        unread = rows
            .where((row) => _secureConversationEvent(row) && row['readAt'] == null)
            .toList(growable: false);
        loading = false;
      });
    } catch (_) {
      // Secure messaging must remain reachable even if the notification list
      // is temporarily unavailable.
      if (mounted) setState(() { unread = const []; loading = false; });
    }
  }

  Future<void> _open() async {
    if (opening || widget.session.account['role'] != 'PATIENT') return;
    setState(() => opening = true);
    final event = unread.isEmpty ? null : unread.first;
    final eventId = event?['id']?.toString();
    final conversationId = event?['entityId']?.toString();

    if (eventId != null && eventId.isNotEmpty) {
      try {
        await widget.session.api.markNotificationRead(eventId).timeout(const Duration(seconds: 30));
      } catch (_) {
        // Notification acknowledgement is intentionally independent from
        // conversation membership/read receipts. The owned conversation may
        // still be opened safely by the server-authorized endpoint.
      }
    }

    if (!mounted) return;
    try {
      final Widget page = conversationId != null && conversationId.isNotEmpty
          ? CareConversationPage(
              session: widget.session,
              locale: widget.locale,
              accent: Theme.of(context).colorScheme.primary,
              conversationId: conversationId,
              isProvider: false,
            )
          : CommunicationsWorkspace(
              session: widget.session,
              locale: widget.locale,
              accent: Theme.of(context).colorScheme.primary,
              isProvider: false,
            );
      await Navigator.push<void>(
        context,
        MaterialPageRoute(
          builder: (_) => Directionality(textDirection: widget.locale.textDirection, child: page),
        ),
      );
    } finally {
      if (mounted) {
        setState(() => opening = false);
        await _load();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.session.account['role'] != 'PATIENT') return const SizedBox.shrink();
    final count = unread.length;
    final label = count == 0
        ? communicationsText(widget.locale, 'messages')
        : '${communicationsText(widget.locale, 'messages')} · $count ${patientMessagesText(widget.locale, 'new')}';
    return OutlinedButton.icon(
      key: const ValueKey('patient-messages-entry'),
      onPressed: opening ? null : _open,
      icon: loading || opening
          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
          : Icon(count > 0 ? Icons.mark_chat_unread_outlined : Icons.forum_outlined),
      label: Text(label),
    );
  }
}

class AppointmentCommunicationsPage extends StatefulWidget {
  const AppointmentCommunicationsPage({
    super.key,
    required this.session,
    required this.locale,
    required this.appointmentId,
    required this.appointmentStatus,
    this.appointmentLabel,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final String appointmentId;
  final String appointmentStatus;
  final String? appointmentLabel;

  @override
  State<AppointmentCommunicationsPage> createState() => _AppointmentCommunicationsPageState();
}

class _AppointmentCommunicationsPageState extends State<AppointmentCommunicationsPage> {
  bool loading = true;
  bool creating = false;
  String? error;
  String? conversationId;
  late final String clientConversationId;
  final subject = TextEditingController();
  final initial = TextEditingController();

  bool get eligible => patientCareConversationEligibleStatus(widget.appointmentStatus);

  @override
  void initState() {
    super.initState();
    clientConversationId =
        'patient-appointment-${DateTime.now().microsecondsSinceEpoch}-${widget.appointmentId}';
    if (eligible) {
      _load();
    } else {
      loading = false;
    }
  }

  @override
  void dispose() {
    subject.dispose();
    initial.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final rows = await widget.session.api.careConversations().timeout(const Duration(seconds: 30));
      if (!mounted) return;
      final matching = rows.where((row) => row['appointmentId']?.toString() == widget.appointmentId);
      setState(() {
        conversationId = matching.isEmpty ? null : matching.first['id']?.toString();
      });
    } catch (_) {
      if (mounted) setState(() => error = patientMessagesText(widget.locale, 'loadFailed'));
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _create() async {
    if (!eligible || creating || subject.text.trim().isEmpty) return;
    setState(() { creating = true; error = null; });
    try {
      final created = await widget.session.api.createCareConversation(
        appointmentId: widget.appointmentId,
        subject: subject.text.trim(),
        initialMessage: initial.text.trim(),
        clientConversationId: clientConversationId,
      ).timeout(const Duration(seconds: 30));
      if (!mounted) return;
      final id = created['id']?.toString();
      if (id != null && id.isNotEmpty) {
        setState(() => conversationId = id);
      } else {
        await _load();
      }
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => creating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.session.account['role'] != 'PATIENT') {
      return Scaffold(body: Center(child: Text(patientMessagesText(widget.locale, 'notEligible'))));
    }
    if (!eligible) {
      return Scaffold(
        appBar: AppBar(title: Text(patientMessagesText(widget.locale, 'appointmentConversation'))),
        body: Center(child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(patientMessagesText(widget.locale, 'notEligible'), textAlign: TextAlign.center),
        )),
      );
    }
    if (loading) {
      return Scaffold(
        appBar: AppBar(title: Text(patientMessagesText(widget.locale, 'appointmentConversation'))),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    if (conversationId?.isNotEmpty == true) {
      return CareConversationPage(
        session: widget.session,
        locale: widget.locale,
        accent: Theme.of(context).colorScheme.primary,
        conversationId: conversationId!,
        isProvider: false,
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(patientMessagesText(widget.locale, 'appointmentConversation'))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Icon(Icons.lock_outline, color: Theme.of(context).colorScheme.primary),
                  const SizedBox(width: 8),
                  Expanded(child: Text(patientMessagesText(widget.locale, 'contextHint'))),
                ]),
                if (widget.appointmentLabel?.trim().isNotEmpty == true) ...[
                  const SizedBox(height: 8),
                  Text(widget.appointmentLabel!, style: const TextStyle(fontWeight: FontWeight.w700)),
                ],
              ]),
            ),
          ),
          const SizedBox(height: 12),
          Text(patientMessagesText(widget.locale, 'noConversation')),
          const SizedBox(height: 12),
          TextField(
            key: const ValueKey('appointment-message-subject'),
            controller: subject,
            maxLength: 240,
            decoration: InputDecoration(
              labelText: communicationsText(widget.locale, 'subject'),
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            key: const ValueKey('appointment-message-initial'),
            controller: initial,
            minLines: 3,
            maxLines: 6,
            maxLength: 12000,
            decoration: InputDecoration(
              labelText: communicationsText(widget.locale, 'initialMessage'),
              border: const OutlineInputBorder(),
            ),
          ),
          if (error != null) ...[
            const SizedBox(height: 8),
            Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
          const SizedBox(height: 12),
          FilledButton.icon(
            key: const ValueKey('appointment-message-create'),
            onPressed: creating ? null : _create,
            icon: creating
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.add_comment_outlined),
            label: Text(patientMessagesText(widget.locale, 'startConversation')),
          ),
        ],
      ),
    );
  }
}
