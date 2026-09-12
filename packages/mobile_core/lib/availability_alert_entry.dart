import 'package:flutter/material.dart';
import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'availability_requests_localization.dart';

typedef AvailabilityAlertOpen = Future<void> Function(String? requestId);

/// Patient-home entry for F4 in-app availability events.
///
/// The event itself may be acknowledged here, but the versioned F3
/// availability notice is deliberately not marked read. The centre owns that
/// separate operation so a newer observation can never be acknowledged by an
/// older notification tap.
class AvailabilityAlertEntryButton extends StatefulWidget {
  const AvailabilityAlertEntryButton({super.key, required this.session, required this.locale, required this.onOpen});
  final CarePointSession session;
  final CarePointLocale locale;
  final AvailabilityAlertOpen onOpen;
  @override
  State<AvailabilityAlertEntryButton> createState() => _AvailabilityAlertEntryButtonState();
}

class _AvailabilityAlertEntryButtonState extends State<AvailabilityAlertEntryButton> {
  bool loading = true, opening = false;
  List<Map<String, dynamic>> unread = const [];
  @override
  void initState() { super.initState(); _load(); }
  @override
  void didUpdateWidget(covariant AvailabilityAlertEntryButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.session != widget.session) _load();
  }
  bool _availabilityEvent(Map<String, dynamic> row) =>
      row['entityType'] == 'AVAILABILITY_REQUEST' && (row['entityId']?.toString().trim().isNotEmpty ?? false);
  Future<void> _load() async {
    if (widget.session.role != 'PATIENT') { if (mounted) setState(() { loading = false; unread = const []; }); return; }
    try {
      final rows = await widget.session.api.notifications().timeout(const Duration(seconds: 30));
      if (!mounted) return;
      setState(() { unread = rows.where((row) => _availabilityEvent(row) && row['readAt'] == null).toList(growable: false); loading = false; });
    } catch (_) {
      // Availability Centre remains reachable even when the notification list is temporarily unavailable.
      if (mounted) setState(() { unread = const []; loading = false; });
    }
  }
  Future<void> _open() async {
    if (opening) return;
    setState(() => opening = true);
    final event = unread.isEmpty ? null : unread.first;
    final requestId = event?['entityId']?.toString();
    final eventId = event?['id']?.toString();
    if (eventId != null && eventId.isNotEmpty) {
      try { await widget.session.api.markNotificationRead(eventId).timeout(const Duration(seconds: 30)); }
      catch (_) { /* The owned request remains useful even if event acknowledgement is temporarily unavailable. */ }
    }
    if (mounted) {
      try { await widget.onOpen(requestId); }
      finally { if (mounted) { setState(() => opening = false); await _load(); } }
    }
  }
  @override
  Widget build(BuildContext context) {
    final count = unread.length;
    final label = count == 0
        ? availabilityText(widget.locale, 'centre')
        : '${availabilityText(widget.locale, 'centre')} · $count ${availabilityText(widget.locale, 'newAlerts')}';
    return OutlinedButton.icon(
      key: const ValueKey('availability-alert-entry'),
      onPressed: opening ? null : _open,
      icon: loading || opening
          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
          : Icon(count > 0 ? Icons.notifications_active_outlined : Icons.notifications_none),
      label: Text(label),
    );
  }
}
