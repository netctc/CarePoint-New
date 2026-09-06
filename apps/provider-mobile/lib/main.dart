import 'package:carepoint_mobile_core/carepoint_auth.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/provider_workspace.dart';
import 'package:flutter/material.dart';

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
        debugShowCheckedModeBanner: false,
        locale: locale.locale,
        theme: ThemeData(useMaterial3: true, colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF10B981))),
        home: Directionality(
          textDirection: locale.textDirection,
          child: Scaffold(
            body: Stack(children: [
              CarePointLoginGate(
                locale: locale,
                expectedRole: 'OTHER_PROVIDER',
                title: cpText(locale, 'provider.title'),
                accent: const Color(0xFF10B981),
                builder: (_, session, signOut) => ProviderWorkspace(
                  session: session,
                  locale: locale,
                  title: cpText(locale, 'provider.title'),
                  accent: const Color(0xFF10B981),
                  onSignOut: signOut,
                ),
              ),
              PositionedDirectional(
                top: 10,
                end: 10,
                child: SafeArea(
                  child: PopupMenuButton<CarePointLocale>(
                    initialValue: locale,
                    onSelected: (value) => setState(() => locale = value),
                    itemBuilder: (_) => CarePointLocale.values.map((item) => PopupMenuItem(value: item, child: Text(item.label))).toList(),
                  ),
                ),
              ),
            ]),
          ),
        ),
      );
}
