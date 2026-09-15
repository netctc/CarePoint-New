import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'communications_localization.dart';

class CommunicationsWorkspace extends StatefulWidget {
  const CommunicationsWorkspace({
    super.key,
    required this.session,
    required this.locale,
    required this.accent,
    required this.isProvider,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Color accent;
  final bool isProvider;

  @override
  State<CommunicationsWorkspace> createState() => _CommunicationsWorkspaceState();
}

class _CommunicationsWorkspaceState extends State<CommunicationsWorkspace> {
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> conversations = const [];
  List<Map<String, dynamic>> notifications = const [];
  List<Map<String, dynamic>> appointments = const [];
  Map<String, dynamic> preferences = const {};

  CarePointApi get api => widget.session.api;

  @override
  void initState() {
    super.initState();
    refresh();
  }

  Future<void> refresh() async {
    setState(() { busy = true; error = null; });
    try {
      final now = DateTime.now();
      final values = await Future.wait<dynamic>([
        api.careConversations(),
        api.notifications(),
        api.notificationPreferences(),
        widget.isProvider
            ? api.providerAppointments(from: now.subtract(const Duration(days: 365)), to: now.add(const Duration(days: 60)))
            : api.myAppointments(),
      ]);
      if (!mounted) return;
      setState(() {
        conversations = _list(values[0]);
        notifications = _list(values[1]);
        preferences = _map(values[2]);
        appointments = _list(values[3]);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => DefaultTabController(
        length: 2,
        child: Scaffold(
          appBar: AppBar(
            title: Text(communicationsText(widget.locale, 'title')),
            actions: [IconButton(onPressed: refresh, icon: const Icon(Icons.refresh_rounded))],
            bottom: TabBar(tabs: [
              Tab(icon: const Icon(Icons.forum_outlined), text: communicationsText(widget.locale, 'messages')),
              Tab(icon: const Icon(Icons.notifications_outlined), text: communicationsText(widget.locale, 'notifications')),
            ]),
          ),
          floatingActionButton: busy || error != null
              ? null
              : FloatingActionButton.extended(
                  heroTag: 'communications-new-${widget.isProvider}',
                  backgroundColor: widget.accent,
                  onPressed: _createConversation,
                  icon: const Icon(Icons.add_comment_outlined),
                  label: Text(communicationsText(widget.locale, 'newConversation')),
                ),
          body: busy
              ? const Center(child: CircularProgressIndicator())
              : error != null
                  ? _CommunicationsError(message: error!, onRetry: refresh)
                  : TabBarView(children: [_messagesBody(), _notificationsBody()]),
        ),
      );

  Widget _messagesBody() => RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Icon(Icons.lock_outline_rounded, color: widget.accent),
                  const SizedBox(width: 10),
                  Expanded(child: Text(communicationsText(widget.locale, 'privacy'))),
                ]),
              ),
            ),
            const SizedBox(height: 10),
            if (conversations.isEmpty)
              _empty(communicationsText(widget.locale, 'noConversations'), Icons.mark_chat_unread_outlined),
            ...conversations.map((item) {
              final unread = _int(item['unreadCount']);
              final status = item['status']?.toString() ?? '';
              final participants = _list(item['participants']);
              final names = participants.map((p) => p['displayName']?.toString()).whereType<String>().where((v) => v.isNotEmpty).join(' · ');
              return Card(
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: widget.accent.withValues(alpha: 0.15),
                    child: Icon(status == 'CLOSED' ? Icons.lock_outline : Icons.forum_outlined, color: widget.accent),
                  ),
                  title: Text(item['subject']?.toString() ?? '', style: const TextStyle(fontWeight: FontWeight.w800)),
                  subtitle: Text([if (names.isNotEmpty) names, status == 'CLOSED' ? communicationsText(widget.locale, 'closed') : communicationsText(widget.locale, 'open')].join('\n')),
                  trailing: unread > 0 ? Badge(label: Text('$unread'), child: const Icon(Icons.mail_outline)) : const Icon(Icons.chevron_right_rounded),
                  onTap: () async {
                    await Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(
                      textDirection: widget.locale.textDirection,
                      child: CareConversationPage(
                        session: widget.session,
                        locale: widget.locale,
                        accent: widget.accent,
                        conversationId: item['id'].toString(),
                        isProvider: widget.isProvider,
                      ),
                    )));
                    await refresh();
                  },
                ),
              );
            }),
          ],
        ),
      );

  Widget _notificationsBody() => RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
          children: [
            _preferencesCard(),
            const SizedBox(height: 14),
            if (notifications.isEmpty)
              _empty(communicationsText(widget.locale, 'noNotifications'), Icons.notifications_none_rounded),
            ...notifications.map((item) => Card(
                  child: ListTile(
                    leading: Icon(item['readAt'] == null ? Icons.notifications_active_outlined : Icons.notifications_none_outlined, color: widget.accent),
                    title: Text(_notificationTitle(item), style: TextStyle(fontWeight: item['readAt'] == null ? FontWeight.w800 : FontWeight.w500)),
                    subtitle: Text('${item['type'] ?? ''} · ${_dateTime(item['createdAt'])}'),
                    trailing: item['readAt'] == null
                        ? TextButton(
                            onPressed: () async { await api.markNotificationRead(item['id'].toString()); await refresh(); },
                            child: Text(communicationsText(widget.locale, 'markRead')),
                          )
                        : const Icon(Icons.done_rounded),
                  ),
                )),
          ],
        ),
      );

  Widget _preferencesCard() {
    bool flag(String key) => preferences[key] == true;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(communicationsText(widget.locale, 'preferences'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(communicationsText(widget.locale, 'inApp')), value: flag('inAppEnabled'), onChanged: (v) => _savePreference(inAppEnabled: v)),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(communicationsText(widget.locale, 'push')), value: flag('pushEnabled'), onChanged: (v) => _savePreference(pushEnabled: v)),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(communicationsText(widget.locale, 'email')), value: flag('emailEnabled'), onChanged: (v) => _savePreference(emailEnabled: v)),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(communicationsText(widget.locale, 'sms')), value: flag('smsEnabled'), onChanged: (v) => _savePreference(smsEnabled: v)),
          const SizedBox(height: 4),
          OutlinedButton.icon(onPressed: _registerPushEndpoint, icon: const Icon(Icons.phonelink_ring_outlined), label: Text(communicationsText(widget.locale, 'registerPush'))),
        ]),
      ),
    );
  }

  Future<void> _savePreference({bool? inAppEnabled, bool? pushEnabled, bool? emailEnabled, bool? smsEnabled}) async {
    try {
      final value = await api.updateNotificationPreferences(
        locale: widget.locale.name,
        inAppEnabled: inAppEnabled,
        pushEnabled: pushEnabled,
        emailEnabled: emailEnabled,
        smsEnabled: smsEnabled,
      );
      if (mounted) setState(() => preferences = value);
    } catch (value) { _showError(value.toString()); }
  }

  Future<void> _registerPushEndpoint() async {
    final controller = TextEditingController();
    final accepted = await showDialog<bool>(context: context, builder: (_) => AlertDialog(
      title: Text(communicationsText(widget.locale, 'registerPush')),
      content: TextField(controller: controller, decoration: InputDecoration(labelText: communicationsText(widget.locale, 'endpoint'))),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: Text(cpText(widget.locale, 'common.cancel'))),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(cpText(widget.locale, 'common.save'))),
      ],
    ));
    if (accepted != true || controller.text.trim().isEmpty) return;
    try {
      await api.registerNotificationEndpoint(channel: 'PUSH', externalEndpointRef: controller.text.trim());
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(communicationsText(widget.locale, 'endpointStored'))));
    } catch (value) { _showError(value.toString()); }
  }

  Future<void> _createConversation() async {
    final candidates = appointments.where((item) => item['status'] == 'CONFIRMED' || item['status'] == 'COMPLETED').toList();
    if (candidates.isEmpty) { _showError(communicationsText(widget.locale, 'selectAppointmentHint')); return; }
    String appointmentId = candidates.first['id'].toString();
    final subject = TextEditingController();
    final initial = TextEditingController();
    final accepted = await showDialog<bool>(context: context, builder: (_) => StatefulBuilder(builder: (_, setDialogState) => AlertDialog(
      title: Text(communicationsText(widget.locale, 'newConversation')),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        DropdownButtonFormField<String>(
          initialValue: appointmentId,
          decoration: InputDecoration(labelText: communicationsText(widget.locale, 'appointmentId'), helperText: communicationsText(widget.locale, 'selectAppointmentHint')),
          items: candidates.map((item) => DropdownMenuItem(value: item['id'].toString(), child: Text(_appointmentLabel(item)))).toList(),
          onChanged: (value) => setDialogState(() => appointmentId = value ?? appointmentId),
        ),
        TextField(controller: subject, decoration: InputDecoration(labelText: communicationsText(widget.locale, 'subject'))),
        TextField(controller: initial, maxLines: 3, decoration: InputDecoration(labelText: communicationsText(widget.locale, 'initialMessage'))),
      ])),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: Text(cpText(widget.locale, 'common.cancel'))),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(communicationsText(widget.locale, 'create'))),
      ],
    )));
    if (accepted != true || subject.text.trim().isEmpty) return;
    try {
      await api.createCareConversation(
        appointmentId: appointmentId,
        subject: subject.text.trim(),
        initialMessage: initial.text.trim(),
        clientConversationId: 'mobile-conversation-${DateTime.now().microsecondsSinceEpoch}-$appointmentId',
      );
      await refresh();
    } catch (value) { _showError(value.toString()); }
  }

  String _appointmentLabel(Map<String, dynamic> item) {
    final service = _map(item['service']);
    final patient = _map(item['patient']);
    final patientName = '${patient['firstName'] ?? ''} ${patient['lastName'] ?? ''}'.trim();
    final serviceName = service['name']?.toString() ?? item['modality']?.toString() ?? '';
    return [serviceName, if (widget.isProvider && patientName.isNotEmpty) patientName, _dateTime(item['startsAt'])].join(' · ');
  }

  String _notificationTitle(Map<String, dynamic> item) {
    final type = item['type']?.toString();
    return switch (type) {
      'SECURE_MESSAGE' => communicationsText(widget.locale, 'messages'),
      'CARE_COORDINATION' => communicationsText(widget.locale, 'careTeam'),
      _ => communicationsText(widget.locale, 'notifications'),
    };
  }

  void _showError(String message) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message))); }
}

class CareConversationPage extends StatefulWidget {
  const CareConversationPage({super.key, required this.session, required this.locale, required this.accent, required this.conversationId, required this.isProvider});
  final CarePointSession session;
  final CarePointLocale locale;
  final Color accent;
  final String conversationId;
  final bool isProvider;

  @override
  State<CareConversationPage> createState() => _CareConversationPageState();
}

class _CareConversationPageState extends State<CareConversationPage> {
  bool busy = true;
  String? error;
  Map<String, dynamic> conversation = const {};
  final message = TextEditingController();

  @override
  void initState() { super.initState(); load(); }
  @override
  void dispose() { message.dispose(); super.dispose(); }

  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try {
      final value = await widget.session.api.careConversation(widget.conversationId);
      await widget.session.api.markCareConversationRead(widget.conversationId);
      if (mounted) setState(() => conversation = value);
    } catch (value) { if (mounted) setState(() => error = value.toString()); }
    finally { if (mounted) setState(() => busy = false); }
  }

  @override
  Widget build(BuildContext context) {
    final closed = conversation['status'] == 'CLOSED';
    final messages = _list(conversation['messages']);
    return Scaffold(
      appBar: AppBar(
        title: Text(conversation['subject']?.toString() ?? communicationsText(widget.locale, 'messages')),
        actions: [
          if (widget.isProvider && !closed) IconButton(onPressed: _addProvider, tooltip: communicationsText(widget.locale, 'careTeam'), icon: const Icon(Icons.group_add_outlined)),
          if (!closed) IconButton(onPressed: _close, tooltip: communicationsText(widget.locale, 'close'), icon: const Icon(Icons.lock_outline_rounded)),
        ],
      ),
      body: busy ? const Center(child: CircularProgressIndicator()) : error != null ? _CommunicationsError(message: error!, onRetry: load) : Column(children: [
        Expanded(child: messages.isEmpty ? Center(child: Text(communicationsText(widget.locale, 'noMessages'))) : ListView.builder(
          padding: const EdgeInsets.all(14), itemCount: messages.length, itemBuilder: (_, index) {
            final item = messages[index];
            final mine = item['senderAccountId']?.toString() == widget.session.account['id']?.toString();
            return Align(
              alignment: mine ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart,
              child: Container(
                constraints: const BoxConstraints(maxWidth: 500), margin: const EdgeInsets.symmetric(vertical: 5), padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: mine ? widget.accent.withValues(alpha: 0.17) : Theme.of(context).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(16)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(item['body']?.toString() ?? ''),
                  if (_list(item['attachmentDocumentIds']).isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Row(children: [const Icon(Icons.attach_file_rounded, size: 16), Text(' ${_list(item['attachmentDocumentIds']).length}')]),
                  ],
                  const SizedBox(height: 4),
                  Text(_dateTime(item['sentAt']), style: Theme.of(context).textTheme.labelSmall),
                ]),
              ),
            );
          },
        )),
        if (closed)
          Padding(padding: const EdgeInsets.all(16), child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [const Icon(Icons.lock_outline), const SizedBox(width: 8), Text(communicationsText(widget.locale, 'closed'))]))
        else
          SafeArea(top: false, child: Padding(padding: const EdgeInsets.all(12), child: Row(children: [
            Expanded(child: TextField(controller: message, maxLines: 4, minLines: 1, decoration: InputDecoration(hintText: communicationsText(widget.locale, 'messageHint'), border: const OutlineInputBorder()))),
            const SizedBox(width: 8),
            IconButton.filled(onPressed: _send, icon: const Icon(Icons.send_rounded)),
          ]))),
      ]),
    );
  }

  Future<void> _send() async {
    final text = message.text.trim();
    if (text.isEmpty) return;
    try {
      await widget.session.api.sendCareMessage(widget.conversationId, body: text, clientMessageId: 'mobile-message-${DateTime.now().microsecondsSinceEpoch}-${widget.conversationId}');
      message.clear(); await load();
    } catch (value) { _showError(value.toString()); }
  }

  Future<void> _close() async {
    try { await widget.session.api.closeCareConversation(widget.conversationId); await load(); }
    catch (value) { _showError(value.toString()); }
  }

  Future<void> _addProvider() async {
    final controller = TextEditingController();
    final accepted = await showDialog<bool>(context: context, builder: (_) => AlertDialog(
      title: Text(communicationsText(widget.locale, 'careTeam')),
      content: TextField(controller: controller, decoration: InputDecoration(labelText: communicationsText(widget.locale, 'providerId'), helperText: communicationsText(widget.locale, 'careTeamHint'))),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: Text(cpText(widget.locale, 'common.cancel'))),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(communicationsText(widget.locale, 'addProvider'))),
      ],
    ));
    if (accepted != true || controller.text.trim().isEmpty) return;
    try { await widget.session.api.addCareParticipant(widget.conversationId, providerId: controller.text.trim()); await load(); }
    catch (value) { _showError(value.toString()); }
  }

  void _showError(String message) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message))); }
}

class _CommunicationsError extends StatelessWidget {
  const _CommunicationsError({required this.message, required this.onRetry});
  final String message;
  final Future<void> Function() onRetry;
  @override
  Widget build(BuildContext context) => Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
    const Icon(Icons.error_outline_rounded, size: 42), const SizedBox(height: 12), Text(message, textAlign: TextAlign.center), const SizedBox(height: 12), OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Retry')),
  ])));
}

Widget _empty(String text, IconData icon) => Padding(padding: const EdgeInsets.all(28), child: Column(children: [Icon(icon, size: 42), const SizedBox(height: 10), Text(text, textAlign: TextAlign.center)]));
Map<String, dynamic> _map(dynamic value) => value is Map<String, dynamic> ? value : value is Map ? value.map((key, item) => MapEntry(key.toString(), item)) : <String, dynamic>{};
List<Map<String, dynamic>> _list(dynamic value) => value is List ? value.map(_map).toList(growable: false) : <Map<String, dynamic>>[];
int _int(dynamic value) => value is int ? value : int.tryParse(value?.toString() ?? '') ?? 0;
String _dateTime(dynamic value) { if (value == null) return ''; final parsed = DateTime.tryParse(value.toString()); return parsed == null ? value.toString() : parsed.toLocal().toString().substring(0, 16); }
