import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

String nutritionText(CarePointLocale locale, String key) =>
    _nutritionStrings[locale.name]?[key] ?? _nutritionStrings['en']![key] ?? key;

const _nutritionStrings = <String, Map<String, String>>{
  'en': {
    'title': 'Nutrition anthropometry',
    'newMeasurement': 'Record measurement',
    'measurement': 'Measurement',
    'customCode': 'Custom measurement code',
    'value': 'Value',
    'unit': 'Unit',
    'measuredAt': 'Measured',
    'source': 'Original',
    'normalized': 'Normalized',
    'empty': 'No anthropometric measurements recorded yet.',
    'saved': 'Anthropometric measurement saved.',
    'required': 'Complete all required fields.',
    'notice': 'Units are normalized while the original value, unit, source and measurement time are preserved. No automated diagnosis is generated.',
    'save': 'Save',
    'cancel': 'Cancel',
    'refresh': 'Refresh',
    'weight': 'Weight',
    'height': 'Height',
    'waist': 'Waist circumference',
    'hip': 'Hip circumference',
    'arm': 'Arm circumference',
    'bodyFat': 'Body fat percentage',
    'custom': 'Custom',
  },
  'ar': {
    'title': 'القياسات الأنثروبومترية للتغذية',
    'newMeasurement': 'تسجيل قياس',
    'measurement': 'القياس',
    'customCode': 'رمز قياس مخصص',
    'value': 'القيمة',
    'unit': 'الوحدة',
    'measuredAt': 'وقت القياس',
    'source': 'الأصل',
    'normalized': 'الموحّد',
    'empty': 'لا توجد قياسات أنثروبومترية مسجلة بعد.',
    'saved': 'تم حفظ القياس الأنثروبومتري.',
    'required': 'أكمل جميع الحقول المطلوبة.',
    'notice': 'يتم توحيد الوحدات مع الاحتفاظ بالقيمة والوحدة والمصدر ووقت القياس الأصلي. لا يتم إنشاء تشخيص آلي.',
    'save': 'حفظ',
    'cancel': 'إلغاء',
    'refresh': 'تحديث',
    'weight': 'الوزن',
    'height': 'الطول',
    'waist': 'محيط الخصر',
    'hip': 'محيط الورك',
    'arm': 'محيط الذراع',
    'bodyFat': 'نسبة الدهون',
    'custom': 'مخصص',
  },
  'fr': {
    'title': 'Anthropométrie nutritionnelle',
    'newMeasurement': 'Enregistrer une mesure',
    'measurement': 'Mesure',
    'customCode': 'Code de mesure personnalisé',
    'value': 'Valeur',
    'unit': 'Unité',
    'measuredAt': 'Mesuré',
    'source': 'Original',
    'normalized': 'Normalisé',
    'empty': 'Aucune mesure anthropométrique enregistrée.',
    'saved': 'Mesure anthropométrique enregistrée.',
    'required': 'Complétez tous les champs obligatoires.',
    'notice': 'Les unités sont normalisées tout en conservant la valeur, l’unité, la source et la date d’origine. Aucun diagnostic automatisé.',
    'save': 'Enregistrer',
    'cancel': 'Annuler',
    'refresh': 'Actualiser',
    'weight': 'Poids',
    'height': 'Taille',
    'waist': 'Tour de taille',
    'hip': 'Tour de hanches',
    'arm': 'Tour de bras',
    'bodyFat': 'Masse grasse',
    'custom': 'Personnalisé',
  },
  'es': {
    'title': 'Antropometría nutricional',
    'newMeasurement': 'Registrar medición',
    'measurement': 'Medición',
    'customCode': 'Código de medición personalizado',
    'value': 'Valor',
    'unit': 'Unidad',
    'measuredAt': 'Medido',
    'source': 'Original',
    'normalized': 'Normalizado',
    'empty': 'Todavía no hay mediciones antropométricas.',
    'saved': 'Medición antropométrica guardada.',
    'required': 'Completa todos los campos obligatorios.',
    'notice': 'Las unidades se normalizan conservando el valor, unidad, origen y fecha originales. No se genera diagnóstico automático.',
    'save': 'Guardar',
    'cancel': 'Cancelar',
    'refresh': 'Actualizar',
    'weight': 'Peso',
    'height': 'Altura',
    'waist': 'Perímetro de cintura',
    'hip': 'Perímetro de cadera',
    'arm': 'Perímetro de brazo',
    'bodyFat': 'Porcentaje de grasa',
    'custom': 'Personalizado',
  },
};

class NutritionAnthropometryPage extends StatefulWidget {
  const NutritionAnthropometryPage({
    super.key,
    required this.session,
    required this.locale,
    required this.appointment,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;

  @override
  State<NutritionAnthropometryPage> createState() => _NutritionAnthropometryPageState();
}

class _NutritionAnthropometryPageState extends State<NutritionAnthropometryPage> {
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> items = const [];

  CarePointLocale get locale => widget.locale;
  String get appointmentId => widget.appointment['id']?.toString() ?? '';
  String get patientId => _map(widget.appointment['patient'])['id']?.toString() ?? '';
  _NutritionApi get api => _NutritionApi(widget.session);

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    if (patientId.isEmpty) {
      setState(() {
        busy = false;
        error = 'Appointment patient context is unavailable.';
      });
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final payload = await api.history(patientId);
      if (!mounted) return;
      setState(() => items = _list(payload['items']).reversed.toList(growable: false));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(nutritionText(locale, 'title')),
          actions: [IconButton(onPressed: busy ? null : load, tooltip: nutritionText(locale, 'refresh'), icon: const Icon(Icons.refresh))],
        ),
        floatingActionButton: FloatingActionButton.extended(
          key: const ValueKey('nutrition-anthropometry-add'),
          onPressed: busy ? null : record,
          icon: const Icon(Icons.straighten_outlined),
          label: Text(nutritionText(locale, 'newMeasurement')),
        ),
        body: SafeArea(
          child: busy
              ? const Center(child: CircularProgressIndicator())
              : error != null
                  ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
                  : RefreshIndicator(
                      onRefresh: load,
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
                        children: [
                          Card(
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Icon(Icons.info_outline),
                                  const SizedBox(width: 12),
                                  Expanded(child: Text(nutritionText(locale, 'notice'))),
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(height: 12),
                          if (items.isEmpty)
                            Padding(padding: const EdgeInsets.all(24), child: Text(nutritionText(locale, 'empty'), textAlign: TextAlign.center))
                          else
                            ...items.map(_measurementCard),
                        ],
                      ),
                    ),
        ),
      );

  Widget _measurementCard(Map<String, dynamic> item) {
    final source = _map(item['source']);
    final code = item['measurementCode']?.toString() ?? '—';
    return Card(
      child: ListTile(
        leading: const CircleAvatar(child: Icon(Icons.monitor_weight_outlined)),
        title: Text(_labelFor(code), style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Text(
          '${nutritionText(locale, 'normalized')}: ${_number(item['value'])} ${item['unit'] ?? ''}\n'
          '${nutritionText(locale, 'source')}: ${_number(source['value'])} ${source['unit'] ?? ''}\n'
          '${nutritionText(locale, 'measuredAt')}: ${_dateTime(item['measuredAt'])}',
        ),
        isThreeLine: true,
      ),
    );
  }

  Future<void> record() async {
    var selectedCode = 'WEIGHT';
    var selectedUnit = 'kg';
    final customCode = TextEditingController();
    final value = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => Directionality(
          textDirection: locale.textDirection,
          child: AlertDialog(
            title: Text(nutritionText(locale, 'newMeasurement')),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: selectedCode,
                    decoration: InputDecoration(labelText: nutritionText(locale, 'measurement')),
                    items: const ['WEIGHT', 'HEIGHT', 'WAIST_CIRCUMFERENCE', 'HIP_CIRCUMFERENCE', 'ARM_CIRCUMFERENCE', 'BODY_FAT_PERCENT', 'CUSTOM']
                        .map((code) => DropdownMenuItem(value: code, child: Text(_labelFor(code))))
                        .toList(growable: false),
                    onChanged: (next) {
                      if (next == null) return;
                      setDialogState(() {
                        selectedCode = next;
                        selectedUnit = next == 'WEIGHT' ? 'kg' : next == 'BODY_FAT_PERCENT' ? '%' : 'cm';
                      });
                    },
                  ),
                  if (selectedCode == 'CUSTOM') ...[
                    const SizedBox(height: 12),
                    TextField(controller: customCode, textCapitalization: TextCapitalization.characters, decoration: InputDecoration(labelText: nutritionText(locale, 'customCode'))),
                  ],
                  const SizedBox(height: 12),
                  TextField(controller: value, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: nutritionText(locale, 'value'))),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: selectedUnit,
                    decoration: InputDecoration(labelText: nutritionText(locale, 'unit')),
                    items: const ['kg', 'g', 'lb', 'cm', 'mm', 'm', 'in', '%', 'kg/m2', '1']
                        .map((unit) => DropdownMenuItem(value: unit, child: Text(unit)))
                        .toList(growable: false),
                    onChanged: (next) => next == null ? null : setDialogState(() => selectedUnit = next),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(nutritionText(locale, 'cancel'))),
              FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(nutritionText(locale, 'save'))),
            ],
          ),
        ),
      ),
    );
    if (accepted != true) return;
    final number = double.tryParse(value.text.trim());
    final code = selectedCode == 'CUSTOM' ? customCode.text.trim().toUpperCase() : selectedCode;
    if (number == null || code.isEmpty || appointmentId.isEmpty) {
      return _message(nutritionText(locale, 'required'));
    }
    try {
      await api.record({
        'appointmentId': appointmentId,
        'idempotencyKey': 'mobile-anthro-${DateTime.now().microsecondsSinceEpoch}',
        'measurementCode': code,
        'value': number,
        'unit': selectedUnit,
        'measuredAt': DateTime.now().toUtc().toIso8601String(),
      });
      _message(nutritionText(locale, 'saved'));
      await load();
    } catch (value) {
      _message(value.toString());
    }
  }

  String _labelFor(String code) {
    switch (code) {
      case 'WEIGHT': return nutritionText(locale, 'weight');
      case 'HEIGHT': return nutritionText(locale, 'height');
      case 'WAIST_CIRCUMFERENCE': return nutritionText(locale, 'waist');
      case 'HIP_CIRCUMFERENCE': return nutritionText(locale, 'hip');
      case 'ARM_CIRCUMFERENCE': return nutritionText(locale, 'arm');
      case 'BODY_FAT_PERCENT': return nutritionText(locale, 'bodyFat');
      case 'CUSTOM': return nutritionText(locale, 'custom');
      default: return code.replaceAll('_', ' ');
    }
  }

  void _message(String value) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }
}

class _NutritionApi {
  const _NutritionApi(this.session);
  final CarePointSession session;

  Future<Map<String, dynamic>> history(String patientId) =>
      _request('GET', '/provider/nutrition/anthropometrics/patients/$patientId');

  Future<Map<String, dynamic>> record(Map<String, dynamic> body) =>
      _request('POST', '/provider/nutrition/anthropometrics', body: body);

  Future<Map<String, dynamic>> _request(String method, String path, {Map<String, dynamic>? body}) async {
    await session.api.me();
    final token = session.api.accessToken;
    if (token == null || token.isEmpty) throw const CarePointApiException('Authentication is required.');
    final uri = Uri.parse('${session.api.baseUrl}$path');
    final headers = <String, String>{
      'accept': 'application/json',
      'authorization': 'Bearer $token',
      if (body != null) 'content-type': 'application/json',
    };
    final response = method == 'GET'
        ? await http.get(uri, headers: headers)
        : await http.post(uri, headers: headers, body: jsonEncode(body));
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
          : 'Request failed (${response.statusCode}).';
      throw CarePointApiException(message, statusCode: response.statusCode, payload: payload);
    }
    return _map(payload);
  }
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _list(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}

String _number(dynamic value) {
  if (value is num) return value.toStringAsFixed(value % 1 == 0 ? 0 : 2);
  return value?.toString() ?? '—';
}

String _dateTime(dynamic raw) {
  final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (value == null) return '—';
  String two(int number) => number.toString().padLeft(2, '0');
  return '${two(value.day)}/${two(value.month)}/${value.year.toString().padLeft(4, '0')} ${two(value.hour)}:${two(value.minute)}';
}
