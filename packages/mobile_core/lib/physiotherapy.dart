import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

String physioText(CarePointLocale locale, String key) =>
    _physioStrings[locale.name]?[key] ?? _physioStrings['en']![key] ?? key;

const _physioStrings = <String, Map<String, String>>{
  'en': {
    'title': 'Physiotherapy',
    'assessment': 'Functional assessment',
    'newAssessment': 'Record assessment',
    'rom': 'Range of motion',
    'newRom': 'Record ROM',
    'source': 'Source form response',
    'sourceHint': 'Select a completed encrypted form from this appointment.',
    'score': 'Score',
    'maximum': 'Maximum score',
    'pain': 'Pain score (0–10)',
    'limitations': 'Limitation codes',
    'limitationsHint': 'Comma-separated structured codes',
    'joint': 'Joint code',
    'movement': 'Movement code',
    'side': 'Side',
    'degrees': 'Degrees',
    'measuredAt': 'Measured',
    'history': 'History',
    'trend': 'ROM trend',
    'noAssessments': 'No functional assessments recorded yet.',
    'noRom': 'No ROM measurements recorded yet.',
    'noSources': 'Submit a category form for this appointment before recording an assessment.',
    'encryptedSource': 'Source answers remain encrypted at rest.',
    'graphReady': 'Ordered measurements are graph-ready; no automated diagnosis is generated.',
    'saved': 'Physiotherapy record saved.',
    'required': 'Complete all required fields.',
    'left': 'Left',
    'right': 'Right',
    'bilateral': 'Bilateral',
    'midline': 'Midline',
    'version': 'Version',
    'sequence': 'Sequence',
    'refresh': 'Refresh',
    'cancel': 'Cancel',
    'save': 'Save',
  },
  'ar': {
    'title': 'العلاج الطبيعي',
    'assessment': 'التقييم الوظيفي',
    'newAssessment': 'تسجيل تقييم',
    'rom': 'مدى الحركة',
    'newRom': 'تسجيل مدى الحركة',
    'source': 'استجابة النموذج المصدر',
    'sourceHint': 'اختر نموذجاً مشفراً ومكتملاً من هذه الزيارة.',
    'score': 'النتيجة',
    'maximum': 'النتيجة القصوى',
    'pain': 'درجة الألم (0–10)',
    'limitations': 'رموز القيود',
    'limitationsHint': 'رموز منظمة مفصولة بفواصل',
    'joint': 'رمز المفصل',
    'movement': 'رمز الحركة',
    'side': 'الجهة',
    'degrees': 'الدرجات',
    'measuredAt': 'وقت القياس',
    'history': 'السجل',
    'trend': 'اتجاه مدى الحركة',
    'noAssessments': 'لا توجد تقييمات وظيفية مسجلة بعد.',
    'noRom': 'لا توجد قياسات لمدى الحركة بعد.',
    'noSources': 'أرسل نموذج الفئة لهذه الزيارة قبل تسجيل التقييم.',
    'encryptedSource': 'تبقى إجابات المصدر مشفرة أثناء التخزين.',
    'graphReady': 'القياسات مرتبة وجاهزة للرسم دون توليد تشخيص آلي.',
    'saved': 'تم حفظ سجل العلاج الطبيعي.',
    'required': 'أكمل جميع الحقول المطلوبة.',
    'left': 'يسار',
    'right': 'يمين',
    'bilateral': 'ثنائي',
    'midline': 'منتصف',
    'version': 'الإصدار',
    'sequence': 'التسلسل',
    'refresh': 'تحديث',
    'cancel': 'إلغاء',
    'save': 'حفظ',
  },
  'fr': {
    'title': 'Kinésithérapie',
    'assessment': 'Évaluation fonctionnelle',
    'newAssessment': 'Enregistrer une évaluation',
    'rom': 'Amplitude articulaire',
    'newRom': 'Enregistrer une amplitude',
    'source': 'Réponse de formulaire source',
    'sourceHint': 'Sélectionnez un formulaire chiffré terminé pour ce rendez-vous.',
    'score': 'Score',
    'maximum': 'Score maximal',
    'pain': 'Score de douleur (0–10)',
    'limitations': 'Codes de limitation',
    'limitationsHint': 'Codes structurés séparés par des virgules',
    'joint': 'Code articulation',
    'movement': 'Code mouvement',
    'side': 'Côté',
    'degrees': 'Degrés',
    'measuredAt': 'Mesuré',
    'history': 'Historique',
    'trend': 'Tendance amplitude',
    'noAssessments': 'Aucune évaluation fonctionnelle enregistrée.',
    'noRom': 'Aucune mesure d’amplitude enregistrée.',
    'noSources': 'Soumettez un formulaire de catégorie pour ce rendez-vous avant l’évaluation.',
    'encryptedSource': 'Les réponses source restent chiffrées au repos.',
    'graphReady': 'Les mesures ordonnées sont prêtes pour le graphique, sans diagnostic automatisé.',
    'saved': 'Dossier de kinésithérapie enregistré.',
    'required': 'Complétez tous les champs obligatoires.',
    'left': 'Gauche',
    'right': 'Droite',
    'bilateral': 'Bilatéral',
    'midline': 'Médian',
    'version': 'Version',
    'sequence': 'Séquence',
    'refresh': 'Actualiser',
    'cancel': 'Annuler',
    'save': 'Enregistrer',
  },
  'es': {
    'title': 'Fisioterapia',
    'assessment': 'Evaluación funcional',
    'newAssessment': 'Registrar evaluación',
    'rom': 'Rango de movimiento',
    'newRom': 'Registrar ROM',
    'source': 'Respuesta de formulario fuente',
    'sourceHint': 'Selecciona un formulario cifrado completado en esta cita.',
    'score': 'Puntuación',
    'maximum': 'Puntuación máxima',
    'pain': 'Dolor (0–10)',
    'limitations': 'Códigos de limitación',
    'limitationsHint': 'Códigos estructurados separados por comas',
    'joint': 'Código de articulación',
    'movement': 'Código de movimiento',
    'side': 'Lado',
    'degrees': 'Grados',
    'measuredAt': 'Medido',
    'history': 'Historial',
    'trend': 'Tendencia ROM',
    'noAssessments': 'Todavía no hay evaluaciones funcionales.',
    'noRom': 'Todavía no hay mediciones de ROM.',
    'noSources': 'Envía un formulario de categoría para esta cita antes de registrar la evaluación.',
    'encryptedSource': 'Las respuestas fuente permanecen cifradas en reposo.',
    'graphReady': 'Las mediciones ordenadas están listas para graficar; no se genera diagnóstico automático.',
    'saved': 'Registro de fisioterapia guardado.',
    'required': 'Completa todos los campos obligatorios.',
    'left': 'Izquierdo',
    'right': 'Derecho',
    'bilateral': 'Bilateral',
    'midline': 'Línea media',
    'version': 'Versión',
    'sequence': 'Secuencia',
    'refresh': 'Actualizar',
    'cancel': 'Cancelar',
    'save': 'Guardar',
  },
};

class PhysiotherapyActionButton extends StatelessWidget {
  const PhysiotherapyActionButton({
    super.key,
    required this.session,
    required this.locale,
    required this.appointment,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
        onPressed: () => Navigator.push<void>(
          context,
          MaterialPageRoute(
            builder: (_) => Directionality(
              textDirection: locale.textDirection,
              child: PhysiotherapyWorkspacePage(
                session: session,
                locale: locale,
                appointment: appointment,
              ),
            ),
          ),
        ),
        icon: const Icon(Icons.accessibility_new_outlined),
        label: Text(physioText(locale, 'title')),
      );
}

class PhysiotherapyWorkspacePage extends StatefulWidget {
  const PhysiotherapyWorkspacePage({
    super.key,
    required this.session,
    required this.locale,
    required this.appointment,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;

  @override
  State<PhysiotherapyWorkspacePage> createState() => _PhysiotherapyWorkspacePageState();
}

class _PhysiotherapyWorkspacePageState extends State<PhysiotherapyWorkspacePage> {
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> sources = const [];
  List<Map<String, dynamic>> assessments = const [];
  List<Map<String, dynamic>> rom = const [];

  CarePointLocale get locale => widget.locale;
  String get appointmentId => widget.appointment['id']?.toString() ?? '';
  String get patientId => _map(widget.appointment['patient'])['id']?.toString() ?? '';
  _PhysioApi get api => _PhysioApi(widget.session);

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    if (appointmentId.isEmpty || patientId.isEmpty) {
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
      final values = await Future.wait([
        api.sourceResponses(appointmentId),
        api.assessmentHistory(patientId),
        api.romHistory(patientId),
      ]);
      if (!mounted) return;
      setState(() {
        sources = _list(_map(values[0])['items']);
        assessments = _list(_map(values[1])['items']);
        rom = _list(_map(values[2])['items']);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(physioText(locale, 'title')),
          actions: [
            IconButton(
              onPressed: busy ? null : load,
              icon: const Icon(Icons.refresh),
              tooltip: physioText(locale, 'refresh'),
            ),
          ],
        ),
        body: busy
            ? const Center(child: CircularProgressIndicator())
            : error != null
                ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
                : RefreshIndicator(
                    onRefresh: load,
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                      children: [
                        _privacyCard(),
                        const SizedBox(height: 12),
                        _assessmentSection(),
                        const SizedBox(height: 16),
                        _romSection(),
                      ],
                    ),
                  ),
      );

  Widget _privacyCard() => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.lock_outline),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(physioText(locale, 'encryptedSource'), style: const TextStyle(fontWeight: FontWeight.w800)),
                    const SizedBox(height: 4),
                    Text(physioText(locale, 'graphReady'), style: const TextStyle(color: Color(0xFF64748B))),
                  ],
                ),
              ),
            ],
          ),
        ),
      );

  Widget _assessmentSection() => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(child: Text(physioText(locale, 'assessment'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
                  FilledButton.tonalIcon(
                    onPressed: sources.isEmpty ? null : _recordAssessment,
                    icon: const Icon(Icons.add_chart_outlined),
                    label: Text(physioText(locale, 'newAssessment')),
                  ),
                ],
              ),
              if (sources.isEmpty) Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Text(physioText(locale, 'noSources'), style: const TextStyle(color: Color(0xFF64748B))),
              ),
              const SizedBox(height: 8),
              if (assessments.isEmpty)
                Padding(padding: const EdgeInsets.symmetric(vertical: 18), child: Text(physioText(locale, 'noAssessments')))
              else
                ...assessments.reversed.map(_assessmentTile),
            ],
          ),
        ),
      );

  Widget _assessmentTile(Map<String, dynamic> item) {
    final scoreMaximum = item['scoreMaximum'];
    final source = _map(item['sourceEvidence']);
    final subtitle = <String>[
      '${physioText(locale, 'score')}: ${item['score']}${scoreMaximum == null ? '' : ' / $scoreMaximum'}',
      if (item['painScore'] != null) '${physioText(locale, 'pain')}: ${item['painScore']}',
      '${physioText(locale, 'version')}: ${source['formVersion'] ?? ''} · ${physioText(locale, 'sequence')}: ${item['sequence'] ?? ''}',
      _dateTime(item['assessedAt']),
    ];
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: const CircleAvatar(child: Icon(Icons.monitor_heart_outlined)),
      title: Text(item['scaleCode']?.toString() ?? physioText(locale, 'assessment'), style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: Text(subtitle.join('\n')),
      isThreeLine: true,
    );
  }

  Widget _romSection() {
    final grouped = <String, List<Map<String, dynamic>>>{};
    for (final item in rom) {
      final key = '${item['jointCode']}:${item['movementCode']}:${item['side']}';
      grouped.putIfAbsent(key, () => []).add(item);
    }
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(child: Text(physioText(locale, 'rom'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
                FilledButton.tonalIcon(
                  onPressed: _recordRom,
                  icon: const Icon(Icons.straighten_outlined),
                  label: Text(physioText(locale, 'newRom')),
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (rom.isEmpty)
              Padding(padding: const EdgeInsets.symmetric(vertical: 18), child: Text(physioText(locale, 'noRom')))
            else ...[
              Text(physioText(locale, 'trend'), style: const TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              ...grouped.entries.map((entry) => _romTrendCard(entry.key, entry.value)),
              const Divider(height: 28),
              Text(physioText(locale, 'history'), style: const TextStyle(fontWeight: FontWeight.w700)),
              ...rom.reversed.map(_romTile),
            ],
          ],
        ),
      ),
    );
  }

  Widget _romTrendCard(String key, List<Map<String, dynamic>> values) => Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(key.replaceAll(':', ' · '), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            SizedBox(height: 76, child: CustomPaint(painter: _RomTrendPainter(values.map((item) => (item['degrees'] as num?)?.toDouble() ?? 0).toList()))),
          ],
        ),
      );

  Widget _romTile(Map<String, dynamic> item) => ListTile(
        contentPadding: EdgeInsets.zero,
        leading: const CircleAvatar(child: Icon(Icons.rotate_90_degrees_ccw_outlined)),
        title: Text('${item['jointCode']} · ${item['movementCode']} · ${item['side']}', style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text('${physioText(locale, 'measuredAt')}: ${_dateTime(item['measuredAt'])}'),
        trailing: Text('${item['degrees']}°', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
      );

  Future<void> _recordAssessment() async {
    if (sources.isEmpty) return;
    String responseId = sources.first['responseId'].toString();
    final score = TextEditingController();
    final maximum = TextEditingController();
    final pain = TextEditingController();
    final limitations = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (context, setModalState) => AlertDialog(
          title: Text(physioText(locale, 'newAssessment')),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: responseId,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: physioText(locale, 'source'), helperText: physioText(locale, 'sourceHint')),
                  items: sources.map((source) {
                    final labels = _map(source['labels']);
                    final label = labels[locale.name]?.toString() ?? labels['en']?.toString() ?? source['formCode']?.toString() ?? '';
                    return DropdownMenuItem(value: source['responseId'].toString(), child: Text('$label · v${source['formVersion']} · #${source['responseSequence']}', overflow: TextOverflow.ellipsis));
                  }).toList(),
                  onChanged: (value) => setModalState(() => responseId = value ?? responseId),
                ),
                const SizedBox(height: 10),
                TextField(controller: score, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: InputDecoration(labelText: physioText(locale, 'score'))),
                TextField(controller: maximum, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: physioText(locale, 'maximum'))),
                TextField(controller: pain, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: physioText(locale, 'pain'))),
                TextField(controller: limitations, textCapitalization: TextCapitalization.characters, decoration: InputDecoration(labelText: physioText(locale, 'limitations'), helperText: physioText(locale, 'limitationsHint'))),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: Text(physioText(locale, 'cancel'))),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(physioText(locale, 'save'))),
          ],
        ),
      ),
    );
    if (accepted != true) return;
    final scoreValue = double.tryParse(score.text.trim());
    if (scoreValue == null) return _message(physioText(locale, 'required'));
    final maxValue = maximum.text.trim().isEmpty ? null : double.tryParse(maximum.text.trim());
    final painValue = pain.text.trim().isEmpty ? null : int.tryParse(pain.text.trim());
    if (maximum.text.trim().isNotEmpty && maxValue == null) return _message(physioText(locale, 'required'));
    if (pain.text.trim().isNotEmpty && painValue == null) return _message(physioText(locale, 'required'));
    final codes = limitations.text
        .split(',')
        .map((item) => item.trim().toUpperCase())
        .where((item) => item.isNotEmpty)
        .toSet()
        .toList();
    try {
      await api.createAssessment({
        'appointmentId': appointmentId,
        'sourceFormResponseId': responseId,
        'score': scoreValue,
        if (maxValue != null) 'scoreMaximum': maxValue,
        if (painValue != null) 'painScore': painValue,
        'limitationCodes': codes,
      });
      _message(physioText(locale, 'saved'));
      await load();
    } catch (value) {
      _message(value.toString());
    }
  }

  Future<void> _recordRom() async {
    final joint = TextEditingController();
    final movement = TextEditingController();
    final degrees = TextEditingController();
    String side = 'LEFT';
    final accepted = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (context, setModalState) => AlertDialog(
          title: Text(physioText(locale, 'newRom')),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(controller: joint, textCapitalization: TextCapitalization.characters, decoration: InputDecoration(labelText: physioText(locale, 'joint'))),
                TextField(controller: movement, textCapitalization: TextCapitalization.characters, decoration: InputDecoration(labelText: physioText(locale, 'movement'))),
                DropdownButtonFormField<String>(
                  initialValue: side,
                  decoration: InputDecoration(labelText: physioText(locale, 'side')),
                  items: [
                    DropdownMenuItem(value: 'LEFT', child: Text(physioText(locale, 'left'))),
                    DropdownMenuItem(value: 'RIGHT', child: Text(physioText(locale, 'right'))),
                    DropdownMenuItem(value: 'BILATERAL', child: Text(physioText(locale, 'bilateral'))),
                    DropdownMenuItem(value: 'MIDLINE', child: Text(physioText(locale, 'midline'))),
                  ],
                  onChanged: (value) => setModalState(() => side = value ?? side),
                ),
                TextField(controller: degrees, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: InputDecoration(labelText: physioText(locale, 'degrees'))),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: Text(physioText(locale, 'cancel'))),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(physioText(locale, 'save'))),
          ],
        ),
      ),
    );
    if (accepted != true) return;
    final degreeValue = double.tryParse(degrees.text.trim());
    if (joint.text.trim().isEmpty || movement.text.trim().isEmpty || degreeValue == null) {
      return _message(physioText(locale, 'required'));
    }
    try {
      await api.createRom({
        'appointmentId': appointmentId,
        'idempotencyKey': 'mobile-rom-${DateTime.now().microsecondsSinceEpoch}',
        'jointCode': joint.text.trim().toUpperCase(),
        'movementCode': movement.text.trim().toUpperCase(),
        'side': side,
        'degrees': degreeValue,
        'measuredAt': DateTime.now().toUtc().toIso8601String(),
      });
      _message(physioText(locale, 'saved'));
      await load();
    } catch (value) {
      _message(value.toString());
    }
  }

  void _message(String value) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }
}

class _PhysioApi {
  const _PhysioApi(this.session);
  final CarePointSession session;

  Future<Map<String, dynamic>> sourceResponses(String appointmentId) =>
      _request('GET', '/provider/physio-assessments/appointments/$appointmentId/source-responses');

  Future<Map<String, dynamic>> assessmentHistory(String patientId) =>
      _request('GET', '/provider/physio-assessments/patients/$patientId');

  Future<Map<String, dynamic>> romHistory(String patientId) =>
      _request('GET', '/provider/range-of-motion/patients/$patientId');

  Future<Map<String, dynamic>> createAssessment(Map<String, dynamic> body) =>
      _request('POST', '/provider/physio-assessments', body: body);

  Future<Map<String, dynamic>> createRom(Map<String, dynamic> body) =>
      _request('POST', '/provider/range-of-motion', body: body);

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

class _RomTrendPainter extends CustomPainter {
  _RomTrendPainter(this.values);
  final List<double> values;

  @override
  void paint(Canvas canvas, Size size) {
    if (values.isEmpty) return;
    final axis = Paint()
      ..color = const Color(0xFFCBD5E1)
      ..strokeWidth = 1;
    final line = Paint()
      ..color = const Color(0xFF0F766E)
      ..strokeWidth = 2.5
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;
    final point = Paint()..color = const Color(0xFF0F766E);
    canvas.drawLine(Offset(0, size.height / 2), Offset(size.width, size.height / 2), axis);
    final path = Path();
    for (var index = 0; index < values.length; index++) {
      final x = values.length == 1 ? size.width / 2 : (index / (values.length - 1)) * size.width;
      final clamped = values[index].clamp(-360.0, 360.0);
      final y = size.height - ((clamped + 360) / 720) * size.height;
      if (index == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
      canvas.drawCircle(Offset(x, y), math.max(2.5, size.height * .035), point);
    }
    if (values.length > 1) canvas.drawPath(path, line);
  }

  @override
  bool shouldRepaint(covariant _RomTrendPainter oldDelegate) => oldDelegate.values != values;
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

String _dateTime(dynamic raw) {
  final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (value == null) return '—';
  String two(int number) => number.toString().padLeft(2, '0');
  return '${two(value.day)}/${two(value.month)}/${value.year.toString().padLeft(4, '0')} ${two(value.hour)}:${two(value.minute)}';
}
