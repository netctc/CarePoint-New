import 'package:carepoint_mobile_core/carepoint_auth.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/provider_workspace.dart';
import 'package:flutter/material.dart';

void main() => runApp(const DoctorApp());

class DoctorApp extends StatefulWidget {
  const DoctorApp({super.key});
  @override
  State<DoctorApp> createState() => _DoctorAppState();
}

class _DoctorAppState extends State<DoctorApp> {
  CarePointLocale locale = CarePointLocale.en;

  @override
  Widget build(BuildContext context) => MaterialApp(
        debugShowCheckedModeBanner: false,
        locale: locale.locale,
        theme: ThemeData(
          useMaterial3: true,
          brightness: Brightness.dark,
          scaffoldBackgroundColor: const Color(0xFF0F172A),
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF22D3EE), brightness: Brightness.dark),
        ),
        home: Directionality(
          textDirection: locale.textDirection,
          child: Scaffold(
            body: Stack(children: [
              CarePointLoginGate(
                locale: locale,
                expectedRole: 'DOCTOR',
                title: cpText(locale, 'doctor.title'),
                accent: const Color(0xFF22D3EE),
                dark: true,
                builder: (_, session, signOut) => ProviderWorkspace(
                  session: session,
                  locale: locale,
                  title: cpText(locale, 'doctor.title'),
                  accent: const Color(0xFF22D3EE),
                  dark: true,
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
