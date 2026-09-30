import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'communications_localization.dart';
import 'communications_workspace.dart';

class SecureContextContactButton extends StatefulWidget {
  const SecureContextContactButton({
    super.key,
    required this.session,
    required this.locale,
    required this.accent,
    required this.appointment,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Color accent;
  final Map<String, dynamic> appointment;

  @override
  State<SecureContextContactButton> createState() => _SecureContextContactButtonState();
}

class _SecureContextContactButtonState extends State<SecureContextContactButton> {
  bool busy = false;

  Future<void> _open() async {
    final appointmentId = widget.appointment['id']?.toString() ?? '';
    if (appointmentId.isEmpty || busy) return;
    setState(() => busy = true);
    try {
      final conversations = await widget.session.api.careConversations();
      Map<String, dynamic>? conversation;
      for (final item in conversations) {
        if (item['appointmentId']?.toString() == appointmentId && item['status'] == 'OPEN') {
          conversation = item;
          break;
        }
      }
      conversation ??= await widget.session.api.secureProviderContact(
        appointmentId: appointmentId,
        subject: communicationsText(widget.locale, 'secureContactSubject'),
        clientContactId: 'secure-contact-' + appointmentId + '-' + DateTime.now().microsecondsSinceEpoch.toString(),
      );
      final id = conversation['id']?.toString();
      if (!mounted || id == null || id.isEmpty) return;
      await Navigator.push<void>(context, MaterialPageRoute(
        builder: (_) => Directionality(
          textDirection: widget.locale.textDirection,
          child: CareConversationPage(
            session: widget.session,
            locale: widget.locale,
            accent: widget.accent,
            conversationId: id,
            isProvider: true,
          ),
        ),
      ));
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(communicationsText(widget.locale, 'secureContactError'))),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
    key: ValueKey('provider-secure-contact-' + (widget.appointment['id']?.toString() ?? '')),
    onPressed: busy ? null : _open,
    icon: busy
        ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
        : const Icon(Icons.lock_person_outlined),
    label: Text(
      busy
          ? communicationsText(widget.locale, 'secureContactOpening')
          : communicationsText(widget.locale, 'secureContact'),
    ),
  );
}
