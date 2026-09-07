import 'package:carepoint_mobile_core/carepoint_auth.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/financial_localization.dart';
import 'package:carepoint_mobile_core/financial_workspace.dart';
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
                builder: (gateContext, session, signOut) => Stack(children: [
                  ProviderWorkspace(
                    session: session,
                    locale: locale,
                    title: cpText(locale, 'provider.title'),
                    accent: const Color(0xFF10B981),
                    onSignOut: signOut,
                  ),
                  PositionedDirectional(
                    start: 16,
                    bottom: 90,
                    child: SafeArea(
                      child: FloatingActionButton.small(
                        heroTag: 'provider-finance',
                        tooltip: financeText(locale, 'finance'),
                        onPressed: () => Navigator.of(gateContext).push(MaterialPageRoute(
                          builder: (_) => Directionality(
                            textDirection: locale.textDirection,
                            child: Scaffold(
                              appBar: AppBar(title: Text(financeText(locale, 'finance'))),
                              body: ProviderFinancialWorkspace(session: session, locale: locale, accent: const Color(0xFF10B981)),
                            ),
                          ),
                        )),
                        child: const Icon(Icons.account_balance_wallet_outlined),
                      ),
                    ),
                  ),
                ]),
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
