import 'package:carepoint_mobile_core/carepoint_auth.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/care_provider_actions.dart';
import 'package:flutter/material.dart';
import 'provider_access.dart';
import 'provider_capability_scope.dart';

void main() => runApp(const ProviderApp());
class ProviderApp extends StatefulWidget {
  const ProviderApp({super.key});
  @override
  State<ProviderApp> createState() => _ProviderAppState();
}
class _ProviderAppState extends State<ProviderApp> {
  CarePointLocale locale = CarePointLocale.en;
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false, locale: locale.locale,
    theme: ThemeData(useMaterial3: true, colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF10B981))),
    home: Directionality(textDirection: locale.textDirection, child: Scaffold(body: Stack(children: [
      CarePointLoginGate(locale: locale, expectedRole: 'OTHER_PROVIDER', title: cpText(locale, 'provider.title'), accent: const Color(0xFF10B981),
        builder: (_, session, signOut) => OtherProviderAccessGate(session: session, locale: locale, onSignOut: signOut, accent: const Color(0xFF10B981),
          activeBuilder: (_) => OtherProviderCapabilityScope(session: session, locale: locale, accent: const Color(0xFF10B981),
            builder: (_, serviceModalities, clinicalOrderCapabilities) => CareProviderActions(session: session, locale: locale, onSignOut: signOut, accent: const Color(0xFF10B981), transport: true,
              allowedModalities: serviceModalities.toList(),
              child: CapabilityAwareProviderWorkspaceWithRevenueCycle(session: session, locale: locale, title: cpText(locale, 'provider.title'), accent: const Color(0xFF10B981), onSignOut: signOut, allowedServiceModalities: serviceModalities, clinicalOrderCapabilities: clinicalOrderCapabilities),
            ),
          ),
        ),
      ),
      PositionedDirectional(top: 10, end: 10, child: SafeArea(child: PopupMenuButton<CarePointLocale>(initialValue: locale, onSelected: (v) => setState(() => locale = v), itemBuilder: (_) => CarePointLocale.values.map((l) => PopupMenuItem(value: l, child: Text(l.label))).toList()))),
    ]))),
  );
}
