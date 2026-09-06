import 'package:carepoint_mobile_core/carepoint_localization.dart';
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
    theme: ThemeData(useMaterial3: true, brightness: Brightness.dark, colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF22D3EE), brightness: Brightness.dark)),
    home: Directionality(textDirection: locale.textDirection, child: DoctorToday(locale: locale, onLocaleChanged: (value) => setState(() => locale = value))),
  );
}

class DoctorToday extends StatelessWidget {
  const DoctorToday({super.key, required this.locale, required this.onLocaleChanged});
  final CarePointLocale locale;
  final ValueChanged<CarePointLocale> onLocaleChanged;
  @override
  Widget build(BuildContext context) {
    const visits = [['09:00', 'Maya K.', 'Clinic · Cardiology follow-up'], ['10:30', 'Karim A.', 'Telemedicine · medication review'], ['12:15', 'Nadine R.', 'Home visit · post-discharge check']];
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(backgroundColor: Colors.transparent, title: Text(cpText(locale, 'doctor.title')), actions: [PopupMenuButton<CarePointLocale>(initialValue: locale, onSelected: onLocaleChanged, itemBuilder: (context) => CarePointLocale.values.map((item) => PopupMenuItem(value: item, child: Text(item.label))).toList())]),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Text(cpText(locale, 'doctor.boundary'), style: const TextStyle(color: Color(0xFF67E8F9), fontSize: 10, fontWeight: FontWeight.w900)),
        const SizedBox(height: 8), Text(cpText(locale, 'doctor.queue'), style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800)), const SizedBox(height: 18),
        ...visits.map((visit) => Container(margin: const EdgeInsets.only(bottom: 10), padding: const EdgeInsets.all(16), decoration: BoxDecoration(color: const Color(0xFF172033), borderRadius: BorderRadius.circular(20)), child: Row(children: [SizedBox(width: 60, child: Text(visit[0], style: const TextStyle(color: Color(0xFF67E8F9), fontWeight: FontWeight.w800))), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(visit[1], style: const TextStyle(fontWeight: FontWeight.w800)), const SizedBox(height: 4), Text(visit[2], style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12))])), Icon(locale.textDirection == TextDirection.rtl ? Icons.chevron_left : Icons.chevron_right)]))),
      ]),
    );
  }
}
