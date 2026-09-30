import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/follow_up_recommendation.dart';
import 'package:flutter/material.dart';

class ProviderFollowUpLauncher extends StatelessWidget {
  const ProviderFollowUpLauncher({
    super.key,
    required this.session,
    required this.locale,
    required this.child,
    this.accent = const Color(0xFF10B981),
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Widget child;
  final Color accent;

  @override
  Widget build(BuildContext context) => Stack(
        children: [
          child,
          PositionedDirectional(
            end: 18,
            bottom: 316,
            child: FloatingActionButton.small(
              heroTag: 'provider-follow-up',
              backgroundColor: accent,
              foregroundColor: Colors.white,
              tooltip: followUpText(locale, 'title'),
              onPressed: () => _chooseAppointment(context),
              child: const Icon(Icons.event_repeat_outlined),
            ),
          ),
        ],
      );

  Future<void> _chooseAppointment(BuildContext context) async {
    try {
      final now = DateTime.now();
      final values = await session.api.providerAppointments(
        from: now.subtract(const Duration(days: 365)),
        to: now.add(const Duration(days: 31)),
      );
      final appointments = values
          .where((item) => item['status'] == 'CONFIRMED' || item['status'] == 'COMPLETED')
          .toList(growable: false)
        ..sort((left, right) => (right['startsAt']?.toString() ?? '').compareTo(left['startsAt']?.toString() ?? ''));
      if (!context.mounted) return;
      if (appointments.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(followUpText(locale, 'empty'))));
        return;
      }
      final selected = await showModalBottomSheet<Map<String, dynamic>>(
        context: context,
        isScrollControlled: true,
        builder: (_) => Directionality(
          textDirection: locale.textDirection,
          child: SafeArea(
            child: FractionallySizedBox(
              heightFactor: .75,
              child: Column(
                children: [
                  ListTile(
                    title: Text(followUpText(locale, 'title'), style: const TextStyle(fontWeight: FontWeight.w800)),
                    trailing: IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close)),
                  ),
                  const Divider(height: 1),
                  Expanded(
                    child: ListView.builder(
                      itemCount: appointments.length,
                      itemBuilder: (sheetContext, index) {
                        final appointment = appointments[index];
                        final patient = _map(appointment['patient']);
                        final service = _map(appointment['service']);
                        final name = [patient['firstName'], patient['lastName']]
                            .whereType<String>()
                            .where((item) => item.trim().isNotEmpty)
                            .join(' ');
                        return ListTile(
                          leading: const CircleAvatar(child: Icon(Icons.person_outline)),
                          title: Text(name.isEmpty ? 'Patient' : name, style: const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text('${service['name'] ?? appointment['modality'] ?? ''}\n${_dateTime(appointment['startsAt'])} · ${appointment['status'] ?? ''}'),
                          isThreeLine: true,
                          onTap: () => Navigator.pop(sheetContext, appointment),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      if (selected == null || !context.mounted) return;
      await Navigator.push<void>(
        context,
        MaterialPageRoute(
          builder: (_) => Directionality(
            textDirection: locale.textDirection,
            child: ProviderFollowUpPage(session: session, locale: locale, appointment: selected),
          ),
        ),
      );
    } catch (value) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

String _dateTime(dynamic raw) {
  final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (value == null) return '—';
  String two(int number) => number.toString().padLeft(2, '0');
  return '${two(value.day)}/${two(value.month)}/${value.year.toString().padLeft(4, '0')} ${two(value.hour)}:${two(value.minute)}';
}
