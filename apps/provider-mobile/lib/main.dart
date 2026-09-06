import 'package:carepoint_mobile_core/carepoint_localization.dart';
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
    home: Directionality(textDirection: locale.textDirection, child: ProviderRoute(locale: locale, onLocaleChanged: (value) => setState(() => locale = value))),
  );
}

class ProviderRoute extends StatelessWidget {
  const ProviderRoute({super.key, required this.locale, required this.onLocaleChanged});
  final CarePointLocale locale;
  final ValueChanged<CarePointLocale> onLocaleChanged;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(cpText(locale, 'provider.title')), actions: [PopupMenuButton<CarePointLocale>(initialValue: locale, onSelected: onLocaleChanged, itemBuilder: (context) => CarePointLocale.values.map((item) => PopupMenuItem(value: item, child: Text(item.label))).toList())]),
    body: ListView(padding: const EdgeInsets.all(20), children: [
      Text(cpText(locale, 'provider.boundary'), style: const TextStyle(color: Color(0xFF047857), fontSize: 10, fontWeight: FontWeight.w900)),
      const SizedBox(height: 8), Text(cpText(locale, 'provider.route'), style: const TextStyle(fontSize: 29, fontWeight: FontWeight.w800)), const SizedBox(height: 16),
      Container(padding: const EdgeInsets.all(18), decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(24)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(cpText(locale, 'provider.nextJob'), style: const TextStyle(color: Color(0xFF67E8F9), fontSize: 10, fontWeight: FontWeight.w900)), const SizedBox(height: 9), Text(cpText(locale, 'provider.nursing'), style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800)), const SizedBox(height: 4), const Text('Hamra · ETA 18 min', style: TextStyle(color: Color(0xFFCBD5E1))), const SizedBox(height: 16), Row(children: [const Icon(Icons.navigation_outlined, color: Color(0xFF22D3EE)), const SizedBox(width: 7), Text(cpText(locale, 'provider.startRoute'), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700))])])),
      const SizedBox(height: 16), Text(cpText(locale, 'provider.note'), style: const TextStyle(color: Color(0xFF64748B), height: 1.5)),
    ]),
  );
}
