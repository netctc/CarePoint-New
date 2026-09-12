import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/provider_workspace.dart';
import 'package:carepoint_mobile_core/revenue_cycle_localization.dart';
import 'package:carepoint_mobile_core/revenue_cycle_workspace.dart';
import 'package:flutter/material.dart';

typedef OtherProviderCapabilityBuilder = Widget Function(
  BuildContext context,
  Set<String> serviceModalities,
  Set<String> clinicalOrderCapabilities,
);

class OtherProviderCapabilityScope extends StatefulWidget {
  const OtherProviderCapabilityScope({
    super.key,
    required this.session,
    required this.locale,
    required this.builder,
    this.accent = const Color(0xFF10B981),
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final OtherProviderCapabilityBuilder builder;
  final Color accent;

  @override
  State<OtherProviderCapabilityScope> createState() => _OtherProviderCapabilityScopeState();
}

class _OtherProviderCapabilityScopeState extends State<OtherProviderCapabilityScope> {
  bool busy = true;
  String? error;
  Set<String> serviceModalities = const {};
  Set<String> clinicalOrderCapabilities = const {};

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    if (mounted) setState(() { busy = true; error = null; });
    try {
      final state = await widget.session.api.providerOnboardingState();
      if (state['accessReady'] != true || _map(state['provider'])['status'] != 'ACTIVE') {
        throw const CarePointApiException('Active Other Provider capability context is required.');
      }
      final onboarding = _map(state['onboarding']);
      final category = _map(onboarding['providerCategory']);
      final capabilities = _map(category['capabilities']);
      if (category.isEmpty) throw const CarePointApiException('Other Provider category capability context is unavailable.');
      final nextModalities = _stringSet(capabilities['enabledModalities']);
      final nextClinical = _stringSet(capabilities['clinicalOrderCapabilities']);
      if (!mounted) return;
      setState(() {
        serviceModalities = nextModalities;
        clinicalOrderCapabilities = nextClinical;
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (busy) return const Center(child: CircularProgressIndicator());
    if (error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.gpp_bad_outlined, size: 46, color: Color(0xFFDC2626)),
            const SizedBox(height: 12),
            Text(error!, textAlign: TextAlign.center),
            const SizedBox(height: 14),
            FilledButton.icon(onPressed: load, icon: const Icon(Icons.refresh), label: Text(cpText(widget.locale, 'common.retry'))),
          ]),
        ),
      );
    }
    return widget.builder(context, serviceModalities, clinicalOrderCapabilities);
  }
}

class CapabilityAwareProviderWorkspaceWithRevenueCycle extends StatelessWidget {
  const CapabilityAwareProviderWorkspaceWithRevenueCycle({
    super.key,
    required this.session,
    required this.locale,
    required this.title,
    required this.accent,
    required this.onSignOut,
    required this.allowedServiceModalities,
    required this.clinicalOrderCapabilities,
    this.dark = false,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final String title;
  final Color accent;
  final VoidCallback onSignOut;
  final Set<String> allowedServiceModalities;
  final Set<String> clinicalOrderCapabilities;
  final bool dark;

  @override
  Widget build(BuildContext context) => Stack(
        children: [
          ProviderWorkspace(
            session: session,
            locale: locale,
            title: title,
            accent: accent,
            onSignOut: onSignOut,
            dark: dark,
            allowedServiceModalities: allowedServiceModalities,
            clinicalOrderCapabilities: clinicalOrderCapabilities,
          ),
          PositionedDirectional(
            end: 18,
            bottom: 92,
            child: FloatingActionButton.small(
              heroTag: 'revenue-cycle-$title',
              backgroundColor: accent,
              foregroundColor: dark ? Colors.black : Colors.white,
              tooltip: revenueText(locale, 'title'),
              onPressed: () => Navigator.push<void>(
                context,
                MaterialPageRoute(
                  builder: (_) => Directionality(
                    textDirection: locale.textDirection,
                    child: ProviderRevenueCyclePage(session: session, locale: locale, accent: accent),
                  ),
                ),
              ),
              child: const Icon(Icons.request_quote_outlined),
            ),
          ),
        ],
      );
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

Set<String> _stringSet(dynamic value) {
  if (value is! List) return <String>{};
  return value.whereType<String>().where((item) => item.trim().isNotEmpty).toSet();
}
