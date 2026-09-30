import 'package:carepoint_mobile_core/carepoint_auth.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/care_provider_actions.dart';
import 'package:carepoint_mobile_core/provider_category_forms.dart';
import 'package:carepoint_mobile_core/provider_supplies.dart';
import 'package:flutter/material.dart';
import 'field_media_entry.dart';
import 'follow_up_entry.dart';
import 'nutrition_entry.dart';
import 'nursing_entry.dart';
import 'physiotherapy_entry.dart';
import 'provider_access.dart';
import 'provider_capability_scope.dart';
import 'service_confirmation_entry.dart';

void main() => runApp(const ProviderApp());
class ProviderApp extends StatefulWidget {
  const ProviderApp({super.key});
  @override
  State<ProviderApp> createState() => _ProviderAppState();
}
class _ProviderAppState extends State<ProviderApp> {
  CarePointLocale locale = CarePointLocale.en;
  final sessionUi = CarePointSessionUiController();

  @override
  void dispose() {
    sessionUi.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    locale: locale.locale,
    theme: ThemeData(useMaterial3: true, colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF10B981))),
    builder: (context, child) => CarePointSessionChrome(
      controller: sessionUi,
      locale: locale,
      onLocaleChanged: (value) => setState(() => locale = value),
      child: child ?? const SizedBox.shrink(),
    ),
    home: Directionality(textDirection: locale.textDirection, child:
      CarePointLoginGate(locale: locale, expectedRole: 'OTHER_PROVIDER', title: cpText(locale, 'provider.title'), accent: const Color(0xFF10B981), sessionUiController: sessionUi,
        builder: (_, session, signOut) => OtherProviderAccessGate(session: session, locale: locale, onSignOut: signOut, accent: const Color(0xFF10B981),
          activeBuilder: (_) => OtherProviderCapabilityScope(session: session, locale: locale, onSignOut: signOut, accent: const Color(0xFF10B981),
            builder: (_, serviceModalities, clinicalOrderCapabilities, observationCodes, workflowCapabilities) => CareProviderActions(session: session, locale: locale, onSignOut: signOut, accent: const Color(0xFF10B981), transport: false,
              allowedModalities: serviceModalities.toList(),
              child: ProviderCategoryFormsLauncher(
                session: session,
                locale: locale,
                workflowCapabilities: workflowCapabilities,
                accent: const Color(0xFF10B981),
                child: ProviderSuppliesLauncher(
                session: session,
                locale: locale,
                workflowCapabilities: workflowCapabilities,
                accent: const Color(0xFF10B981),
                child: ProviderNursingLauncher(
                  session: session,
                locale: locale,
                workflowCapabilities: workflowCapabilities,
                observationCodes: observationCodes,
                accent: const Color(0xFF10B981),
                child: ProviderFieldMediaLauncher(
                  session: session,
                  locale: locale,
                  workflowCapabilities: workflowCapabilities,
                  accent: const Color(0xFF10B981),
                  child: ProviderFollowUpLauncher(
                    session: session,
                    locale: locale,
                    accent: const Color(0xFF10B981),
                    child: ServiceConfirmationLauncher(
                      session: session,
                      locale: locale,
                      workflowCapabilities: workflowCapabilities,
                      accent: const Color(0xFF10B981),
                      child: NutritionCapabilityLauncher(
                        session: session,
                        locale: locale,
                        clinicalOrderCapabilities: clinicalOrderCapabilities,
                        accent: const Color(0xFF10B981),
                        child: PhysiotherapyCapabilityLauncher(
                          session: session,
                          locale: locale,
                          clinicalOrderCapabilities: clinicalOrderCapabilities,
                          accent: const Color(0xFF10B981),
                          child: CapabilityAwareProviderWorkspaceWithRevenueCycle(
                            session: session,
                            locale: locale,
                            title: cpText(locale, 'provider.title'),
                            accent: const Color(0xFF10B981),
                            onSignOut: signOut,
                            allowedServiceModalities: serviceModalities,
                            clinicalOrderCapabilities: clinicalOrderCapabilities,
                            sessionUiController: sessionUi,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
