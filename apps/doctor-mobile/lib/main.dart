import 'package:carepoint_mobile_core/carepoint_auth.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/care_provider_actions.dart';
import 'package:carepoint_mobile_core/revenue_cycle_workspace.dart';
import 'package:flutter/material.dart';
import 'doctor_access.dart';

void main() => runApp(const DoctorApp());

class DoctorApp extends StatefulWidget {
  const DoctorApp({super.key});

  @override
  State<DoctorApp> createState() => _DoctorAppState();
}

class _DoctorAppState extends State<DoctorApp> {
  CarePointLocale locale = CarePointLocale.en;
  final sessionUi = CarePointSessionUiController();
  final navigatorKey = GlobalKey<NavigatorState>();
  final navigatorObserver = CarePointSessionNavigatorObserver();

  @override
  void dispose() {
    sessionUi.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
        debugShowCheckedModeBanner: false,
    navigatorKey: navigatorKey,
    navigatorObservers: [navigatorObserver],
        locale: locale.locale,
        theme: ThemeData(
          useMaterial3: true,
          brightness: Brightness.dark,
          scaffoldBackgroundColor: const Color(0xFF0F172A),
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF22D3EE),
            brightness: Brightness.dark,
          ),
        ),
        builder: (context, child) => CarePointSessionChrome(
          controller: sessionUi,
          navigatorKey: navigatorKey,
          navigatorObserver: navigatorObserver,
          locale: locale,
          dark: true,
          onLocaleChanged: (value) => setState(() => locale = value),
          child: child ?? const SizedBox.shrink(),
        ),
        home: Directionality(
          textDirection: locale.textDirection,
          child: CarePointLoginGate(
            locale: locale,
            expectedRole: 'DOCTOR',
            title: cpText(locale, 'doctor.title'),
            accent: const Color(0xFF22D3EE),
            dark: true,
            sessionUiController: sessionUi,
            builder: (_, session, signOut) => DoctorAccessGate(
              session: session,
              locale: locale,
              onSignOut: signOut,
              accent: const Color(0xFF22D3EE),
              dark: true,
              activeBuilder: (_) => CareProviderActions(
                session: session,
                locale: locale,
                onSignOut: signOut,
                accent: const Color(0xFF22D3EE),
                dark: true,
                allowedModalities: const ['CLINIC', 'TELEMEDICINE', 'HOME_VISIT'],
                child: ProviderWorkspaceWithRevenueCycle(
                  session: session,
                  locale: locale,
                  title: cpText(locale, 'doctor.title'),
                  accent: const Color(0xFF22D3EE),
                  dark: true,
                  onSignOut: signOut,
                  sessionUiController: sessionUi,
                ),
              ),
            ),
          ),
        ),
      );
}
