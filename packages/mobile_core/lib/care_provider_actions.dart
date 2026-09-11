import 'package:flutter/material.dart';
import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'care_journeys_localization.dart';
import 'care_provider_schedule.dart';
import 'financial_workspace.dart';
import 'communications_workspace.dart';
import 'professional_account_workspace.dart';
import 'transport_workspace.dart';

/// A single labelled menu replaces stacked floating shortcuts, preserving the
/// pre-existing workspaces and adding the functional agenda under access gates.
class CareProviderActions extends StatelessWidget {
  const CareProviderActions({super.key, required this.child, required this.session, required this.locale, required this.allowedModalities, required this.onSignOut, required this.accent, this.dark = false, this.transport = false});
  final Widget child;
  final CarePointSession session;
  final CarePointLocale locale;
  final List<String> allowedModalities;
  final VoidCallback onSignOut;
  final Color accent;
  final bool dark, transport;
  String t(String key) => journeyText(locale, key);
  @override
  Widget build(BuildContext context) => Stack(children: [child,
    PositionedDirectional(start: 16, bottom: 90, child: SafeArea(child: Material(elevation: 4, borderRadius: BorderRadius.circular(16), child: PopupMenuButton<String>(
      tooltip: t('actions'),
      itemBuilder: (_) => ['schedule', 'finance', 'messages', if (transport) 'transport', 'account'].map((key) => PopupMenuItem(value: key, child: Text(t(key)))).toList(),
      onSelected: (key) {
        final Widget page = switch (key) {
          'schedule' => CareProviderSchedule(session: session, locale: locale, allowedModalities: allowedModalities),
          'finance' => Scaffold(appBar: AppBar(title: Text(t('finance'))), body: ProviderFinancialWorkspace(session: session, locale: locale, accent: accent)),
          'messages' => CommunicationsWorkspace(session: session, locale: locale, accent: accent, isProvider: true),
          'transport' => ProviderTransportWorkspace(session: session, locale: locale, accent: accent),
          _ => ProfessionalAccountWorkspace(session: session, locale: locale, accent: accent, dark: dark, onSignOut: onSignOut),
        };
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => Directionality(textDirection: locale.textDirection, child: page)));
      },
      child: Padding(padding: const EdgeInsets.all(14), child: Row(mainAxisSize: MainAxisSize.min, children: [const Icon(Icons.menu), const SizedBox(width: 8), Text(t('actions'))])),
    )))),
  ]);
}
