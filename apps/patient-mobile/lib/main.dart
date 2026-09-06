import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:flutter/material.dart';

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
    debugShowCheckedModeBanner: false,
    locale: locale.locale,
    theme: ThemeData(useMaterial3: true, scaffoldBackgroundColor: const Color(0xFFF8FAFC), colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0EA5E9))),
    home: Directionality(textDirection: locale.textDirection, child: PatientHome(locale: locale, onLocaleChanged: (value) => setState(() => locale = value))),
  );
}

class PatientHome extends StatelessWidget {
  const PatientHome({super.key, required this.locale, required this.onLocaleChanged});
  final CarePointLocale locale;
  final ValueChanged<CarePointLocale> onLocaleChanged;

  void requestEmergency(BuildContext context) => showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (context) => Directionality(
      textDirection: locale.textDirection,
      child: SafeArea(child: Padding(padding: const EdgeInsets.all(20), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(cpText(locale, 'patient.emergencyTitle'), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
        const SizedBox(height: 12),
        Text(cpText(locale, 'patient.emergencyText')),
        const SizedBox(height: 20),
        FilledButton.icon(style: FilledButton.styleFrom(backgroundColor: const Color(0xFFE11D48), minimumSize: const Size.fromHeight(56)), onPressed: () => Navigator.pop(context), icon: const Icon(Icons.local_shipping_outlined), label: Text(cpText(locale, 'patient.requestNow'))),
        TextButton(onPressed: () => Navigator.pop(context), child: Text(cpText(locale, 'patient.cancel'))),
      ]))),
    ),
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(child: ListView(padding: const EdgeInsets.all(20), children: [
      Row(children: [
        Container(width: 42, height: 42, decoration: BoxDecoration(gradient: const LinearGradient(colors: [Color(0xFF0EA5E9), Color(0xFF22D3EE)]), borderRadius: BorderRadius.circular(14)), child: const Center(child: Text('C+', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)))),
        const SizedBox(width: 10), const Expanded(child: Text('CarePoint', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Color(0xFF006591)))),
        PopupMenuButton<CarePointLocale>(initialValue: locale, onSelected: onLocaleChanged, itemBuilder: (context) => CarePointLocale.values.map((item) => PopupMenuItem(value: item, child: Text(item.label))).toList()),
      ]),
      const SizedBox(height: 30),
      Text(cpText(locale, 'patient.greeting'), style: const TextStyle(fontSize: 29, fontWeight: FontWeight.w800)),
      const SizedBox(height: 5), Text(cpText(locale, 'patient.prompt'), style: const TextStyle(color: Color(0xFF64748B))),
      const SizedBox(height: 20),
      InkWell(onTap: () => requestEmergency(context), borderRadius: BorderRadius.circular(24), child: Container(padding: const EdgeInsets.all(18), decoration: BoxDecoration(color: const Color(0xFFFFF1F2), border: Border.all(color: const Color(0xFFFDA4AF)), borderRadius: BorderRadius.circular(24)), child: Row(children: [
        const CircleAvatar(radius: 26, backgroundColor: Color(0xFFE11D48), child: Icon(Icons.emergency_share_outlined, color: Colors.white)),
        const SizedBox(width: 14), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(cpText(locale, 'patient.emergency'), style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: Color(0xFFBE123C))), const SizedBox(height: 4), Text(cpText(locale, 'patient.emergencyAction'), style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800)), const SizedBox(height: 3), Text(cpText(locale, 'patient.emergencyHint'), style: const TextStyle(fontSize: 12, color: Color(0xFF9F1239))) ])),
        Icon(locale.textDirection == TextDirection.rtl ? Icons.chevron_left : Icons.chevron_right, color: const Color(0xFFBE123C)),
      ]))),
      const SizedBox(height: 18),
      GridView.count(shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), crossAxisCount: 2, mainAxisSpacing: 12, crossAxisSpacing: 12, children: [
        _Action(icon: Icons.calendar_month_outlined, text: cpText(locale, 'patient.book')),
        _Action(icon: Icons.video_call_outlined, text: cpText(locale, 'patient.telemedicine')),
        _Action(icon: Icons.home_health_outlined, text: cpText(locale, 'patient.homeCare')),
        _Action(icon: Icons.search_rounded, text: cpText(locale, 'patient.findCare')),
      ]),
    ])),
  );
}

class _Action extends StatelessWidget {
  const _Action({required this.icon, required this.text});
  final IconData icon; final String text;
  @override
  Widget build(BuildContext context) => Container(padding: const EdgeInsets.all(16), decoration: BoxDecoration(color: Colors.white, border: Border.all(color: const Color(0xFFE2E8F0)), borderRadius: BorderRadius.circular(21)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Icon(icon, color: const Color(0xFF0EA5E9)), const Spacer(), Text(text, style: const TextStyle(fontWeight: FontWeight.w800))]));
}
