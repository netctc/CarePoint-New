import 'package:carepoint_mobile_core/carepoint_auth.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/communications_localization.dart';
import 'package:carepoint_mobile_core/communications_workspace.dart';
import 'package:carepoint_mobile_core/financial_localization.dart';
import 'package:carepoint_mobile_core/financial_workspace.dart';
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
                builder: (gateContext, session, signOut) => DoctorAccessGate(
                  session: session,
                  locale: locale,
                  onSignOut: signOut,
                  accent: const Color(0xFF22D3EE),
                  dark: true,
                  activeBuilder: (accessContext) => Stack(children: [
                    ProviderWorkspaceWithRevenueCycle(
                      session: session,
                      locale: locale,
                      title: cpText(locale, 'doctor.title'),
                      accent: const Color(0xFF22D3EE),
                      dark: true,
                      onSignOut: signOut,
                    ),
                    PositionedDirectional(
                      start: 16,
                      bottom: 90,
                      child: SafeArea(
                        child: FloatingActionButton.small(
                          heroTag: 'doctor-finance',
                          tooltip: financeText(locale, 'finance'),
                          onPressed: () => Navigator.of(accessContext).push(MaterialPageRoute(
                            builder: (_) => Directionality(
                              textDirection: locale.textDirection,
                              child: Scaffold(
                                appBar: AppBar(title: Text(financeText(locale, 'finance'))),
                                body: ProviderFinancialWorkspace(session: session, locale: locale, accent: const Color(0xFF22D3EE)),
                              ),
                            ),
                          )),
                          child: const Icon(Icons.account_balance_wallet_outlined),
                        ),
                      ),
                    ),
                    PositionedDirectional(
                      start: 16,
                      bottom: 150,
                      child: SafeArea(
                        child: FloatingActionButton.small(
                          heroTag: 'doctor-communications',
                          tooltip: communicationsText(locale, 'title'),
                          onPressed: () => Navigator.of(accessContext).push(MaterialPageRoute(
                            builder: (_) => Directionality(
                              textDirection: locale.textDirection,
                              child: CommunicationsWorkspace(session: session, locale: locale, accent: const Color(0xFF22D3EE), isProvider: true),
                            ),
                          )),
                          child: const Icon(Icons.forum_outlined),
                        ),
                      ),
                    ),
                  ]),
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
