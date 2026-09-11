import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_auth.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/clinical_localization.dart';
import 'package:carepoint_mobile_core/financial_localization.dart';
import 'package:carepoint_mobile_core/financial_workspace.dart';
import 'package:carepoint_mobile_core/patient_care_journeys.dart';
import 'package:carepoint_mobile_core/care_visits.dart';
import 'package:carepoint_mobile_core/care_journeys_localization.dart';
import 'package:carepoint_mobile_core/transport_localization.dart';
import 'package:carepoint_mobile_core/availability_centre.dart';
import 'package:carepoint_mobile_core/availability_requests_localization.dart';
import 'package:flutter/material.dart';
import 'clinical_timeline.dart';
import 'patient_account.dart';
import 'patient_transport.dart';

void main() => runApp(const CarePointPatientApp());
class CarePointPatientApp extends StatefulWidget {
  const CarePointPatientApp({super.key});
  @override
  State<CarePointPatientApp> createState() => _CarePointPatientAppState();
}
class _CarePointPatientAppState extends State<CarePointPatientApp> {
  CarePointLocale locale = CarePointLocale.en;
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false, locale: locale.locale,
    theme: ThemeData(useMaterial3: true, scaffoldBackgroundColor: const Color(0xFFF8FAFC), colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0EA5E9))),
    home: Directionality(textDirection: locale.textDirection, child: Scaffold(body: Stack(children: [
      CarePointLoginGate(locale: locale, expectedRole: 'PATIENT', title: 'CarePoint Patient', builder: (_, session, signOut) => PatientShell(session: session, locale: locale, onSignOut: signOut)),
      PositionedDirectional(top: 10, end: 10, child: SafeArea(child: PopupMenuButton<CarePointLocale>(initialValue: locale, onSelected: (v) => setState(() => locale = v), itemBuilder: (_) => CarePointLocale.values.map((l) => PopupMenuItem(value: l, child: Text(l.label))).toList()))),
    ]))),
  );
}
class PatientShell extends StatefulWidget {
  const PatientShell({super.key, required this.session, required this.locale, required this.onSignOut});
  final CarePointSession session;
  final CarePointLocale locale;
  final VoidCallback onSignOut;
  @override
  State<PatientShell> createState() => _PatientShellState();
}
class _PatientShellState extends State<PatientShell> {
  int tab = 0, visitsVersion = 0;
  Future<void> openAvailability() async {
    final booked = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => CareAvailabilityCentrePage(session: widget.session, locale: widget.locale)));
    if (mounted && booked == true) setState(() { visitsVersion++; tab = 1; });
  }
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('CarePoint'), actions: [PopupMenuButton<String>(onSelected: (v) { if (v == 'logout') widget.onSignOut(); }, itemBuilder: (_) => [PopupMenuItem(value: 'logout', child: Text(cpText(widget.locale, 'auth.signOut')))])]),
    body: IndexedStack(index: tab, children: [
      CareDiscoveryPage(session: widget.session, locale: widget.locale, onBooked: () => setState(() { visitsVersion++; tab = 1; }), header: Padding(padding: const EdgeInsets.only(bottom: 20), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        FilledButton.icon(onPressed: () => openEmergencyAmbulanceFlow(context, session: widget.session, locale: widget.locale), icon: const Icon(Icons.emergency_share_outlined), label: Text(cpText(widget.locale, 'patient.emergencyAction'))),
        Text(cpText(widget.locale, 'patient.emergencyHint')),
        OutlinedButton.icon(onPressed: () => Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(textDirection: widget.locale.textDirection, child: PatientMedicalTransportPage(session: widget.session, locale: widget.locale)))), icon: const Icon(Icons.local_shipping_outlined), label: Text(transportText(widget.locale, 'schedule'))),
        OutlinedButton.icon(onPressed: openAvailability, icon: const Icon(Icons.notifications_none), label: Text(availabilityText(widget.locale, 'centre'))),
      ]))),
      CareVisitsPage(key: ValueKey(visitsVersion), session: widget.session, locale: widget.locale),
      PatientClinicalTimelinePage(session: widget.session, locale: widget.locale),
      PatientFinancialWorkspace(key: ValueKey('finance-$visitsVersion'), session: widget.session, locale: widget.locale),
      PatientAccountPage(session: widget.session, locale: widget.locale, onSignOut: widget.onSignOut),
    ]),
    bottomNavigationBar: NavigationBar(selectedIndex: tab, onDestinationSelected: (v) => setState(() { tab = v; if (v == 1) visitsVersion++; }), destinations: [
      NavigationDestination(icon: const Icon(Icons.search), label: journeyText(widget.locale, 'search')),
      NavigationDestination(icon: const Icon(Icons.event_note), label: journeyText(widget.locale, 'visits')),
      NavigationDestination(icon: const Icon(Icons.health_and_safety_outlined), label: clinicalText(widget.locale, 'healthRecord')),
      NavigationDestination(icon: const Icon(Icons.account_balance_wallet_outlined), label: financeText(widget.locale, 'finance')),
      NavigationDestination(icon: const Icon(Icons.manage_accounts_outlined), label: journeyText(widget.locale, 'account')),
    ]),
  );
}
