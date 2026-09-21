import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/service_signature.dart';
import 'package:flutter/material.dart';

class ServiceConfirmationLauncher extends StatelessWidget {
  const ServiceConfirmationLauncher({
    super.key,
    required this.session,
    required this.locale,
    required this.workflowCapabilities,
    required this.child,
    this.accent = const Color(0xFF10B981),
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Set<String> workflowCapabilities;
  final Widget child;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    if (!workflowCapabilities.contains('SERVICE_COMPLETION_CHECKLIST')) return child;
    return Stack(children: [
      child,
      PositionedDirectional(end: 18, bottom: 316, child: FloatingActionButton.small(
        heroTag: 'provider-service-confirmation', backgroundColor: accent, foregroundColor: Colors.white,
        tooltip: serviceSignatureText(locale, 'title'), onPressed: () => _choose(context), child: const Icon(Icons.verified_outlined),
      )),
    ]);
  }

  Future<void> _choose(BuildContext context) async {
    try {
      final now = DateTime.now();
      final values = await session.api.providerAppointments(from: now.subtract(const Duration(days: 365)), to: now.add(const Duration(days: 31)));
      final items = values.where((item) => item['status'] == 'CONFIRMED' || item['status'] == 'COMPLETED').toList(growable: false);
      if (!context.mounted) return;
      if (items.isEmpty) return;
      final selected = await showModalBottomSheet<Map<String, dynamic>>(
        context: context,
        builder: (sheetContext) => Directionality(
          textDirection: locale.textDirection,
          child: SafeArea(child: ListView(shrinkWrap: true, children: items.map((item) {
            final patient = _map(item['patient']);
            final name = [patient['firstName'], patient['lastName']].whereType<String>().join(' ');
            return ListTile(
              leading: const Icon(Icons.person_outline),
              title: Text(name.trim().isEmpty ? 'Patient' : name),
              subtitle: Text('${item['modality'] ?? ''} · ${item['status'] ?? ''}'),
              onTap: () => Navigator.pop(sheetContext, item),
            );
          }).toList(growable: false))),
        ),
      );
      if (selected == null || !context.mounted) return;
      await Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(
        textDirection: locale.textDirection,
        child: ProviderServiceSignaturePage(session: session, locale: locale, appointment: selected),
      )));
    } catch (value) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((k, v) => MapEntry(k.toString(), v));
  return <String, dynamic>{};
}
