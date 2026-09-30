import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_auth.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/transport_workspace.dart';
import 'package:carepoint_mobile_core/transport_location.dart';
import 'package:geolocator/geolocator.dart';
import 'package:flutter/material.dart';

const _transportFamilies = <String>{
  'MEDICAL_TRANSPORT_GROUND',
  'MEDICAL_TRANSPORT_AIR',
  'EMERGENCY_AMBULANCE',
};

void main() => runApp(const CarePointTransportProviderApp());

class CarePointTransportProviderApp extends StatefulWidget {
  const CarePointTransportProviderApp({super.key});

  @override
  State<CarePointTransportProviderApp> createState() =>
      _CarePointTransportProviderAppState();
}

class _CarePointTransportProviderAppState
    extends State<CarePointTransportProviderApp> {
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
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFFF97316)),
        ),
        builder: (context, child) => CarePointSessionChrome(
          controller: sessionUi,
          locale: locale,
          onLocaleChanged: (value) => setState(() => locale = value),
          child: child ?? const SizedBox.shrink(),
        ),
        home: Directionality(
          textDirection: locale.textDirection,
          child: CarePointLoginGate(
            locale: locale,
            expectedRole: 'OTHER_PROVIDER',
            title: 'CarePoint Transport Provider',
            accent: const Color(0xFFF97316),
            sessionUiController: sessionUi,
            builder: (_, session, signOut) => _TransportProviderAccessGate(
              session: session,
              locale: locale,
              onSignOut: signOut,
            ),
          ),
        ),
      );
}

class _TransportProviderAccessGate extends StatefulWidget {
  const _TransportProviderAccessGate({
    required this.session,
    required this.locale,
    required this.onSignOut,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final VoidCallback onSignOut;

  @override
  State<_TransportProviderAccessGate> createState() =>
      _TransportProviderAccessGateState();
}

class _TransportProviderAccessGateState
    extends State<_TransportProviderAccessGate> {
  bool loading = true;
  String? error;
  bool transportProvider = false;
  bool accessReady = false;
  String? family;
  String? companyName;
  String? companyCode;
  String companyMode = 'LEGACY_PROVIDER_SCOPE';

  @override
  void initState() {
    super.initState();
    refresh();
  }

  Future<void> refresh() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final state = await widget.session.api.providerOnboardingState();
      final provider = _map(state['provider']);
      final profile = _map(provider['otherProviderProfile']);
      final providerCategory = _map(profile['category']);
      final onboarding = _map(state['onboarding']);
      final onboardingCategory = _map(onboarding['providerCategory']);
      final resolvedFamily =
          (providerCategory['family'] ?? onboardingCategory['family'])?.toString();
      final resolvedTransportProvider = _transportFamilies.contains(resolvedFamily);
      final resolvedAccessReady = resolvedTransportProvider &&
          state['accessReady'] == true &&
          provider['status'] == 'ACTIVE';

      String? resolvedCompanyName;
      String? resolvedCompanyCode;
      var resolvedCompanyMode = 'LEGACY_PROVIDER_SCOPE';
      if (resolvedTransportProvider && resolvedAccessReady) {
        try {
          final context = await widget.session.api.providerTransportCompanyContext();
          final company = _map(context['company']);
          resolvedCompanyName = company['displayName']?.toString();
          resolvedCompanyCode = company['code']?.toString();
          resolvedCompanyMode =
              context['migrationMode']?.toString() ?? resolvedCompanyMode;
        } catch (_) {
          // Company context is additive. A transport provider remains usable
          // in legacy scope while the organizational migration is incomplete.
        }
      }

      if (!mounted) return;
      setState(() {
        family = resolvedFamily;
        transportProvider = resolvedTransportProvider;
        accessReady = resolvedAccessReady;
        companyName = resolvedCompanyName;
        companyCode = resolvedCompanyCode;
        companyMode = resolvedCompanyMode;
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    if (error != null) {
      return _message(
        icon: Icons.error_outline,
        title: 'Transport Provider access unavailable',
        message: error!,
      );
    }
    if (!transportProvider) {
      return _message(
        icon: Icons.no_transfer_outlined,
        title: 'Transport Provider account required',
        message:
            'This application is restricted to medical transport and emergency ambulance provider families.',
      );
    }
    if (!accessReady) {
      return _message(
        icon: Icons.verified_user_outlined,
        title: 'Transport Provider activation required',
        message:
            'Your Transport Provider profile must complete credential review and Admin activation before operational access is enabled.',
      );
    }

    return ProviderTransportWorkspace(
      session: widget.session,
      locale: widget.locale,
      accent: const Color(0xFFF97316),
      onSignOut: widget.onSignOut,
      organizationLabel: companyName ?? 'Independent Transport Provider',
      organizationDetail: companyName == null
          ? companyMode
          : [companyCode, companyMode].whereType<String>().join(' · '),
      telemetryPositionProvider: const _TransportProviderTelemetryPositionProvider(),
    );
  }

  Widget _message({
    required IconData icon,
    required String title,
    required String message,
  }) =>
      Scaffold(
        appBar: AppBar(
          title: const Text('CarePoint Transport Provider'),
          actions: [
            IconButton(
              onPressed: refresh,
              tooltip: 'Refresh',
              icon: const Icon(Icons.refresh_rounded),
            ),
            IconButton(
              onPressed: widget.onSignOut,
              tooltip: 'Sign out',
              icon: const Icon(Icons.logout_rounded),
            ),
          ],
        ),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 56),
                const SizedBox(height: 14),
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(message, textAlign: TextAlign.center),
                if (family != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    family!,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ],
              ],
            ),
          ),
        ),
      );
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    return value.map((key, item) => MapEntry(key.toString(), item));
  }
  return <String, dynamic>{};
}


class _TransportProviderTelemetryPositionProvider
    implements TransportTelemetryPositionProvider {
  const _TransportProviderTelemetryPositionProvider();

  @override
  Future<TransportTelemetryPosition> currentTelemetryPosition() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw const TransportLocationUnavailableException('SERVICE_DISABLED');
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      throw const TransportLocationUnavailableException('PERMISSION_DENIED');
    }
    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 15),
      ),
    );
    return TransportTelemetryPosition(
      latitude: position.latitude,
      longitude: position.longitude,
      capturedAt: position.timestamp,
      accuracyMeters: position.accuracy.isFinite ? position.accuracy : null,
      headingDegrees: position.heading.isFinite && position.heading >= 0
          ? position.heading
          : null,
      speedKph: position.speed.isFinite && position.speed >= 0
          ? position.speed * 3.6
          : null,
    );
  }
}
