import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'package:flutter/material.dart';

String providerFieldRouteText(CarePointLocale locale, String key) {
  const values = <String, Map<String, String>>{
    'title': {'en': 'Home visit route & ETA', 'ar': 'مسار الزيارة المنزلية ووقت الوصول', 'fr': 'Itinéraire et ETA de la visite', 'es': 'Ruta y ETA de visita domiciliaria'},
    'subtitle': {'en': 'Operational route assistance. Provider location is not stored.', 'ar': 'مساعدة تشغيلية للمسار. لا يتم تخزين موقع مقدم الخدمة.', 'fr': 'Aide opérationnelle. La position du prestataire n’est pas stockée.', 'es': 'Asistencia operativa. La ubicación del proveedor no se almacena.'},
    'destination': {'en': 'Destination', 'ar': 'الوجهة', 'fr': 'Destination', 'es': 'Destino'},
    'eta': {'en': 'ETA', 'ar': 'وقت الوصول المتوقع', 'fr': 'ETA', 'es': 'ETA'},
    'distance': {'en': 'Estimated distance', 'ar': 'المسافة التقديرية', 'fr': 'Distance estimée', 'es': 'Distancia estimada'},
    'source': {'en': 'Estimate source', 'ar': 'مصدر التقدير', 'fr': 'Source de l’estimation', 'es': 'Fuente de estimación'},
    'refresh': {'en': 'Refresh ETA', 'ar': 'تحديث وقت الوصول', 'fr': 'Actualiser l’ETA', 'es': 'Actualizar ETA'},
    'openMap': {'en': 'Open device map', 'ar': 'فتح خريطة الجهاز', 'fr': 'Ouvrir la carte de l’appareil', 'es': 'Abrir mapa del dispositivo'},
    'noEstimate': {'en': 'No ETA has been recorded yet.', 'ar': 'لم يتم تسجيل وقت وصول متوقع بعد.', 'fr': 'Aucune ETA n’a encore été enregistrée.', 'es': 'Todavía no se ha registrado una ETA.'},
    'privacy': {'en': 'Only ETA/status can be exposed to the patient. No provider location history or route geometry is persisted.', 'ar': 'يمكن للمريض رؤية وقت الوصول/الحالة فقط. لا يتم حفظ سجل موقع مقدم الخدمة أو هندسة المسار.', 'fr': 'Seuls l’ETA et le statut peuvent être exposés au patient. Aucun historique de position ni géométrie de route n’est conservé.', 'es': 'Al paciente solo se le puede exponer ETA/estado. No se guarda historial de ubicación del proveedor ni geometría de ruta.'},
    'minutes': {'en': 'min', 'ar': 'دقيقة', 'fr': 'min', 'es': 'min'},
    'km': {'en': 'km', 'ar': 'كم', 'fr': 'km', 'es': 'km'},
    'retry': {'en': 'Retry', 'ar': 'إعادة المحاولة', 'fr': 'Réessayer', 'es': 'Reintentar'},
    'mapUnavailable': {'en': 'No compatible map application is available.', 'ar': 'لا يوجد تطبيق خرائط متوافق.', 'fr': 'Aucune application de cartographie compatible.', 'es': 'No hay una aplicación de mapas compatible.'},
  };
  final language = switch (locale) {
    CarePointLocale.ar => 'ar',
    CarePointLocale.fr => 'fr',
    CarePointLocale.es => 'es',
    _ => 'en',
  };
  return values[key]?[language] ?? values[key]?['en'] ?? key;
}

class ProviderFieldRouteApi {
  ProviderFieldRouteApi(this.session);
  final CarePointSession session;

  Future<Map<String, dynamic>> route(String jobId) =>
      _request('GET', '/provider/jobs/${Uri.encodeComponent(jobId)}/route');

  Future<Map<String, dynamic>> estimate(String jobId, {required String idempotencyKey}) =>
      _request(
        'POST',
        '/provider/jobs/${Uri.encodeComponent(jobId)}/route/estimate',
        body: {'idempotencyKey': idempotencyKey},
      );

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool retryAuth = true,
  }) async {
    final uri = Uri.parse('${session.api.baseUrl}$path');
    final headers = <String, String>{
      'accept': 'application/json',
      if (body != null) 'content-type': 'application/json',
      if (session.api.accessToken?.isNotEmpty == true) 'authorization': 'Bearer ${session.api.accessToken}',
    };
    final encoded = body == null ? null : jsonEncode(body);
    final response = switch (method) {
      'GET' => await http.get(uri, headers: headers),
      'POST' => await http.post(uri, headers: headers, body: encoded),
      _ => throw const CarePointApiException('Unsupported field-route request method.'),
    };
    if (response.statusCode == 401 && retryAuth && session.api.refreshToken?.isNotEmpty == true) {
      try {
        await session.api.me();
      } catch (_) {
        // Session boundary owns final logout/redirect behavior.
      }
      return _request(method, path, body: body, retryAuth: false);
    }
    dynamic payload;
    if (response.body.isNotEmpty) {
      try {
        payload = jsonDecode(response.body);
      } catch (_) {
        payload = response.body;
      }
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = payload is Map && payload['message'] != null
          ? payload['message'].toString()
          : 'Field route request failed (${response.statusCode}).';
      throw CarePointApiException(message, statusCode: response.statusCode, payload: payload);
    }
    if (payload is Map<String, dynamic>) return payload;
    if (payload is Map) return payload.map((key, value) => MapEntry(key.toString(), value));
    throw const CarePointApiException('Unexpected field-route response shape.');
  }
}

class ProviderFieldRoutePage extends StatefulWidget {
  const ProviderFieldRoutePage({
    super.key,
    required this.session,
    required this.locale,
    required this.workItem,
    this.accent = const Color(0xFF10B981),
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> workItem;
  final Color accent;

  @override
  State<ProviderFieldRoutePage> createState() => _ProviderFieldRoutePageState();
}

class _ProviderFieldRoutePageState extends State<ProviderFieldRoutePage> {
  late final ProviderFieldRouteApi api;
  bool loading = true;
  bool estimating = false;
  String? error;
  Map<String, dynamic> route = const {};

  String get jobId =>
      widget.workItem['id']?.toString() ??
      'HOME_VISIT:${widget.workItem['jobId']?.toString() ?? ''}';

  @override
  void initState() {
    super.initState();
    api = ProviderFieldRouteApi(widget.session);
    _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() { loading = true; error = null; });
    try {
      final next = await api.route(jobId);
      if (mounted) setState(() => route = next);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _estimate() async {
    if (estimating) return;
    setState(() => estimating = true);
    try {
      final safe = jobId.replaceAll(RegExp(r'[^A-Za-z0-9_.:-]'), '');
      final next = await api.estimate(
        jobId,
        idempotencyKey: 'route-$safe-${DateTime.now().microsecondsSinceEpoch}',
      );
      if (!mounted) return;
      setState(() { route = next; error = null; });
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    } finally {
      if (mounted) setState(() => estimating = false);
    }
  }

  Future<void> _openMap() async {
    final destination = _map(route['destination']);
    final latitude = destination['latitude'];
    final longitude = destination['longitude'];
    if (latitude is! num || longitude is! num) {
      _message(providerFieldRouteText(widget.locale, 'mapUnavailable'));
      return;
    }
    final uri = Uri.parse('geo:${latitude.toDouble()},${longitude.toDouble()}?q=${latitude.toDouble()},${longitude.toDouble()}');
    final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!opened && mounted) _message(providerFieldRouteText(widget.locale, 'mapUnavailable'));
  }

  void _message(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final destination = _map(route['destination']);
    final estimate = _map(route['latestEstimate']);
    final address = [
      destination['addressLine1'],
      destination['addressLine2'],
      destination['city'],
      destination['region'],
      destination['postalCode'],
      destination['countryCode'],
    ].whereType<String>().where((value) => value.trim().isNotEmpty).join(', ');
    final eta = estimate['etaMinutes'];
    final distance = estimate['distanceMeters'];
    return Scaffold(
      appBar: AppBar(
        title: Text(providerFieldRouteText(widget.locale, 'title')),
        actions: [IconButton(onPressed: loading ? null : _load, icon: const Icon(Icons.refresh_rounded))],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(providerFieldRouteText(widget.locale, 'subtitle'), style: const TextStyle(color: Color(0xFF64748B))),
          const SizedBox(height: 12),
          if (loading) const LinearProgressIndicator(),
          if (error != null) ...[
            Card(
              child: ListTile(
                leading: const Icon(Icons.error_outline),
                title: Text(error!),
                trailing: TextButton(onPressed: _load, child: Text(providerFieldRouteText(widget.locale, 'retry'))),
              ),
            ),
            const SizedBox(height: 12),
          ],
          Card(
            child: ListTile(
              leading: const Icon(Icons.home_work_outlined),
              title: Text(providerFieldRouteText(widget.locale, 'destination')),
              subtitle: Text(address.isEmpty ? '—' : address),
            ),
          ),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (estimate.isEmpty)
                  Text(providerFieldRouteText(widget.locale, 'noEstimate'))
                else ...[
                  Text(
                    '${providerFieldRouteText(widget.locale, 'eta')}: $eta ${providerFieldRouteText(widget.locale, 'minutes')}',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 6),
                  if (distance is num)
                    Text('${providerFieldRouteText(widget.locale, 'distance')}: ${(distance / 1000).toStringAsFixed(1)} ${providerFieldRouteText(widget.locale, 'km')}'),
                  Text('${providerFieldRouteText(widget.locale, 'source')}: ${estimate['source'] ?? '—'}'),
                ],
                const SizedBox(height: 14),
                Wrap(spacing: 10, runSpacing: 10, children: [
                  FilledButton.icon(
                    onPressed: estimating ? null : _estimate,
                    icon: estimating
                        ? const SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.schedule_outlined),
                    label: Text(providerFieldRouteText(widget.locale, 'refresh')),
                  ),
                  OutlinedButton.icon(
                    onPressed: destination.isEmpty ? null : _openMap,
                    icon: const Icon(Icons.map_outlined),
                    label: Text(providerFieldRouteText(widget.locale, 'openMap')),
                  ),
                ]),
              ]),
            ),
          ),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Icon(Icons.privacy_tip_outlined),
                const SizedBox(width: 10),
                Expanded(child: Text(providerFieldRouteText(widget.locale, 'privacy'))),
              ]),
            ),
          ),
        ],
      ),
    );
  }

  Map<String, dynamic> _map(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
    return const {};
  }
}