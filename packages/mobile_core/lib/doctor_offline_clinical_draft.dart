import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'provider_offline_sync_api.dart';

const Duration doctorOfflineClinicalDraftLifetime = Duration(hours: 72);

class DoctorOfflineClinicalDraftLocal {
  const DoctorOfflineClinicalDraftLocal({
    required this.clientDraftId,
    required this.appointmentId,
    required this.serverVersion,
    required this.clientRevision,
    required this.clinicalDraft,
    required this.updatedAt,
    required this.expiresAt,
    required this.state,
    this.conflictId,
  });

  final String clientDraftId;
  final String appointmentId;
  final int serverVersion;
  final int clientRevision;
  final Map<String, dynamic> clinicalDraft;
  final DateTime updatedAt;
  final DateTime expiresAt;
  final String state;
  final String? conflictId;

  bool get isExpired => !expiresAt.isAfter(DateTime.now().toUtc());

  DoctorOfflineClinicalDraftLocal copyWith({
    int? serverVersion,
    int? clientRevision,
    Map<String, dynamic>? clinicalDraft,
    DateTime? updatedAt,
    DateTime? expiresAt,
    String? state,
    String? conflictId,
    bool clearConflict = false,
  }) => DoctorOfflineClinicalDraftLocal(
    clientDraftId: clientDraftId,
    appointmentId: appointmentId,
    serverVersion: serverVersion ?? this.serverVersion,
    clientRevision: clientRevision ?? this.clientRevision,
    clinicalDraft: clinicalDraft ?? this.clinicalDraft,
    updatedAt: updatedAt ?? this.updatedAt,
    expiresAt: expiresAt ?? this.expiresAt,
    state: state ?? this.state,
    conflictId: clearConflict ? null : (conflictId ?? this.conflictId),
  );

  Map<String, dynamic> toJson() => {
    'clientDraftId': clientDraftId,
    'appointmentId': appointmentId,
    'serverVersion': serverVersion,
    'clientRevision': clientRevision,
    'clinicalDraft': clinicalDraft,
    'updatedAt': updatedAt.toUtc().toIso8601String(),
    'expiresAt': expiresAt.toUtc().toIso8601String(),
    'state': state,
    'conflictId': conflictId,
  };

  static DoctorOfflineClinicalDraftLocal? fromJson(dynamic value) {
    if (value is! Map) return null;
    final map = value.map((key, item) => MapEntry(key.toString(), item));
    final appointmentId = map['appointmentId']?.toString() ?? '';
    final clientDraftId = map['clientDraftId']?.toString() ?? '';
    final expiresAt = DateTime.tryParse(map['expiresAt']?.toString() ?? '');
    if (appointmentId.isEmpty || clientDraftId.isEmpty || expiresAt == null) return null;
    final clinical = map['clinicalDraft'];
    return DoctorOfflineClinicalDraftLocal(
      clientDraftId: clientDraftId,
      appointmentId: appointmentId,
      serverVersion: int.tryParse('${map['serverVersion'] ?? 0}') ?? 0,
      clientRevision: int.tryParse('${map['clientRevision'] ?? 1}') ?? 1,
      clinicalDraft: clinical is Map
          ? clinical.map((key, item) => MapEntry(key.toString(), item))
          : <String, dynamic>{},
      updatedAt: DateTime.tryParse(map['updatedAt']?.toString() ?? '') ?? DateTime.now().toUtc(),
      expiresAt: expiresAt.toUtc(),
      state: map['state']?.toString() ?? 'PENDING',
      conflictId: map['conflictId']?.toString(),
    );
  }
}

class DoctorOfflineClinicalDraftStore {
  DoctorOfflineClinicalDraftStore(String accountId, {FlutterSecureStorage? storage})
      : _key = 'carepoint.doctor.offline_clinical.$accountId',
        _storage = storage ?? const FlutterSecureStorage();

  final String _key;
  final FlutterSecureStorage _storage;

  Future<List<DoctorOfflineClinicalDraftLocal>> load() async {
    final encoded = await _storage.read(key: _key);
    if (encoded == null || encoded.isEmpty) return [];
    try {
      final decoded = jsonDecode(encoded);
      if (decoded is! List) return [];
      final all = decoded.map(DoctorOfflineClinicalDraftLocal.fromJson).whereType<DoctorOfflineClinicalDraftLocal>().toList(growable: false);
      final active = all.where((draft) => !draft.isExpired).toList(growable: true);
      if (active.length != all.length) await _write(active);
      return active;
    } catch (_) {
      return [];
    }
  }

  Future<void> save(DoctorOfflineClinicalDraftLocal draft) async {
    if (draft.isExpired) {
      await remove(draft.clientDraftId);
      return;
    }
    final drafts = await load();
    final index = drafts.indexWhere((item) => item.clientDraftId == draft.clientDraftId);
    if (index < 0) { drafts.add(draft); } else { drafts[index] = draft; }
    await _write(drafts);
  }

  Future<void> remove(String clientDraftId) async {
    final drafts = await load();
    drafts.removeWhere((item) => item.clientDraftId == clientDraftId);
    await _write(drafts);
  }

  Future<void> _write(List<DoctorOfflineClinicalDraftLocal> drafts) =>
      _storage.write(key: _key, value: jsonEncode(drafts.map((item) => item.toJson()).toList(growable: false)));
}

class DoctorOfflineClinicalDraftPage extends StatefulWidget {
  const DoctorOfflineClinicalDraftPage({
    super.key,
    required this.session,
    required this.locale,
    required this.accent,
    required this.appointment,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Color accent;
  final Map<String, dynamic> appointment;

  @override
  State<DoctorOfflineClinicalDraftPage> createState() => _DoctorOfflineClinicalDraftPageState();
}

class _DoctorOfflineClinicalDraftPageState extends State<DoctorOfflineClinicalDraftPage> {
  late final DoctorOfflineClinicalDraftStore store;
  DoctorOfflineClinicalDraftLocal? draft;
  bool loading = true;
  String? error;

  late final TextEditingController chiefComplaint;
  late final TextEditingController subjective;
  late final TextEditingController objective;
  late final TextEditingController assessment;
  late final TextEditingController plan;
  late final TextEditingController heartRate;
  late final TextEditingController systolic;
  late final TextEditingController diastolic;
  late final TextEditingController oxygen;
  late final TextEditingController temperature;
  late final TextEditingController respiratoryRate;
  late final TextEditingController weight;
  late final TextEditingController painScore;

  String get appointmentId => widget.appointment['id']?.toString() ?? '';
  String t(String key) => doctorOfflineClinicalDraftText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    final accountId = widget.session.account['id']?.toString() ?? widget.session.account['email']?.toString() ?? 'doctor';
    store = DoctorOfflineClinicalDraftStore(accountId);
    chiefComplaint = TextEditingController();
    subjective = TextEditingController();
    objective = TextEditingController();
    assessment = TextEditingController();
    plan = TextEditingController();
    heartRate = TextEditingController();
    systolic = TextEditingController();
    diastolic = TextEditingController();
    oxygen = TextEditingController();
    temperature = TextEditingController();
    respiratoryRate = TextEditingController();
    weight = TextEditingController();
    painScore = TextEditingController();
    _load();
  }

  @override
  void dispose() {
    for (final controller in [chiefComplaint, subjective, objective, assessment, plan, heartRate, systolic, diastolic, oxygen, temperature, respiratoryRate, weight, painScore]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final drafts = await store.load();
      final conflicts = await widget.session.api.doctorOfflineClinicalConflicts();
      var current = drafts.where((item) => item.appointmentId == appointmentId).firstOrNull;
      if (current != null) {
        final conflict = conflicts.where((item) => item['clientDraftId']?.toString() == current!.clientDraftId).firstOrNull;
        if (conflict != null) {
          current = current.copyWith(state: 'CONFLICT', conflictId: conflict['id']?.toString());
          await store.save(current);
        }
        _fill(current.clinicalDraft);
      }
      if (mounted) setState(() => draft = current);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  void _fill(Map<String, dynamic> clinical) {
    chiefComplaint.text = clinical['chiefComplaint']?.toString() ?? '';
    subjective.text = clinical['subjective']?.toString() ?? '';
    objective.text = clinical['objective']?.toString() ?? '';
    assessment.text = clinical['assessment']?.toString() ?? '';
    plan.text = clinical['plan']?.toString() ?? '';
    final vitals = _map(clinical['vitals']);
    heartRate.text = _value(vitals['heartRateBpm']);
    systolic.text = _value(vitals['systolicMmHg']);
    diastolic.text = _value(vitals['diastolicMmHg']);
    oxygen.text = _value(vitals['oxygenSaturationPct']);
    temperature.text = _value(vitals['temperatureC']);
    respiratoryRate.text = _value(vitals['respiratoryRate']);
    weight.text = _value(vitals['weightKg']);
    painScore.text = _value(vitals['painScore']);
  }

  Map<String, dynamic> _clinicalDraft() => {
    'chiefComplaint': _text(chiefComplaint),
    'subjective': _text(subjective),
    'objective': _text(objective),
    'assessment': _text(assessment),
    'plan': _text(plan),
    'vitals': {
      if (_number(heartRate) != null) 'heartRateBpm': _number(heartRate),
      if (_number(systolic) != null) 'systolicMmHg': _number(systolic),
      if (_number(diastolic) != null) 'diastolicMmHg': _number(diastolic),
      if (_number(oxygen) != null) 'oxygenSaturationPct': _number(oxygen),
      if (_number(temperature) != null) 'temperatureC': _number(temperature),
      if (_number(respiratoryRate) != null) 'respiratoryRate': _number(respiratoryRate),
      if (_number(weight) != null) 'weightKg': _number(weight),
      if (_number(painScore) != null) 'painScore': _number(painScore),
    },
  };

  Future<void> _saveLocal() async {
    final now = DateTime.now().toUtc();
    final current = draft;
    final next = DoctorOfflineClinicalDraftLocal(
      clientDraftId: current?.clientDraftId ?? _newDoctorDraftId(),
      appointmentId: appointmentId,
      serverVersion: current?.serverVersion ?? 0,
      clientRevision: (current?.clientRevision ?? 0) + 1,
      clinicalDraft: _clinicalDraft(),
      updatedAt: now,
      expiresAt: now.add(doctorOfflineClinicalDraftLifetime),
      state: 'PENDING',
    );
    await store.save(next);
    if (mounted) {
      setState(() => draft = next);
      _message(t('saved'));
    }
  }

  Future<void> _sync() async {
    await _saveLocal();
    final current = draft;
    if (current == null || current.isExpired) return;
    try {
      final result = await widget.session.api.syncDoctorOfflineClinicalDraft({
        'appointmentId': current.appointmentId,
        'clientDraftId': current.clientDraftId,
        'clientRevision': current.clientRevision,
        'baseServerVersion': current.serverVersion,
        'idempotencyKey': 'doctor-offline:${current.clientDraftId}:${current.clientRevision}',
        'clinicalDraft': current.clinicalDraft,
        'clientUpdatedAt': current.updatedAt.toIso8601String(),
      });
      final conflict = result['outcome'] == 'CONFLICT';
      final updated = current.copyWith(
        serverVersion: conflict ? null : int.tryParse('${result['serverVersion'] ?? current.serverVersion}'),
        state: conflict ? 'CONFLICT' : 'SYNCED',
        conflictId: conflict ? result['conflictId']?.toString() : null,
        clearConflict: !conflict,
      );
      await store.save(updated);
      if (mounted) {
        setState(() => draft = updated);
        _message(t(conflict ? 'conflictCreated' : 'synced'));
      }
    } catch (value) {
      _message(value.toString(), error: true);
    }
  }

  Future<void> _resolve() async {
    final current = draft;
    final conflictId = current?.conflictId;
    if (current == null || conflictId == null) return;
    try {
      final detail = await widget.session.api.doctorOfflineClinicalConflict(conflictId);
      if (!mounted) return;
      final choice = await showDialog<String>(context: context, builder: (dialogContext) => AlertDialog(
        title: Text(t('resolve')),
        content: Text(t('conflictBody')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: Text(t('cancel'))),
          OutlinedButton(onPressed: () => Navigator.pop(dialogContext, 'KEEP_SERVER'), child: Text(t('keepServer'))),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, 'USE_CLIENT'), child: Text(t('useLocal'))),
        ],
      ));
      if (choice == null) return;
      final result = await widget.session.api.resolveDoctorOfflineClinicalConflict(conflictId, resolution: choice);
      var updated = current.copyWith(
        serverVersion: int.tryParse('${result['serverVersion'] ?? current.serverVersion}') ?? current.serverVersion,
        state: 'SYNCED',
        clearConflict: true,
      );
      if (choice == 'KEEP_SERVER') {
        final server = _map(result['serverSnapshot']);
        final serverClinical = _map(server['clinicalDraft']);
        if (serverClinical.isNotEmpty) {
          _fill(serverClinical);
          updated = updated.copyWith(clinicalDraft: serverClinical, updatedAt: DateTime.now().toUtc());
        }
      }
      await store.save(updated);
      if (mounted) {
        setState(() => draft = updated);
        _message(t('synced'));
      }
      if (detail['currentServerVersion'] == null) {
        _message(t('conflictBody'));
      }
    } catch (value) {
      _message(value.toString(), error: true);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(t('title'))),
    body: loading
        ? const Center(child: CircularProgressIndicator())
        : error != null
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Card(child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Text(t('subtitle'), style: const TextStyle(fontWeight: FontWeight.w800)),
                      const SizedBox(height: 6),
                      Text(t('safety'), style: const TextStyle(color: Color(0xFF64748B))),
                      if (draft != null) ...[
                        const SizedBox(height: 8),
                        Text('${t('state')}: ${draft!.state} · ${t('expires')}: ${_date(draft!.expiresAt)}'),
                      ],
                    ]),
                  )),
                  const SizedBox(height: 12),
                  _field(chiefComplaint, 'chiefComplaint', 2),
                  _field(subjective, 'subjective', 4),
                  _field(objective, 'objective', 4),
                  _field(assessment, 'assessment', 4),
                  _field(plan, 'plan', 4),
                  Text(t('vitals'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  Wrap(spacing: 10, runSpacing: 10, children: [
                    _numberField(heartRate, 'heartRate'),
                    _numberField(systolic, 'systolic'),
                    _numberField(diastolic, 'diastolic'),
                    _numberField(oxygen, 'oxygen'),
                    _numberField(temperature, 'temperature'),
                    _numberField(respiratoryRate, 'respiratoryRate'),
                    _numberField(weight, 'weight'),
                    _numberField(painScore, 'painScore'),
                  ]),
                  const SizedBox(height: 18),
                  FilledButton.icon(
                    key: const ValueKey('doctor-offline-save-local'),
                    onPressed: _saveLocal,
                    icon: const Icon(Icons.lock_outline),
                    label: Text(t('saveLocal')),
                    style: FilledButton.styleFrom(backgroundColor: widget.accent),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    key: const ValueKey('doctor-offline-sync'),
                    onPressed: _sync,
                    icon: const Icon(Icons.sync),
                    label: Text(t('sync')),
                  ),
                  if (draft?.state == 'CONFLICT' && draft?.conflictId != null) ...[
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      key: const ValueKey('doctor-offline-resolve'),
                      onPressed: _resolve,
                      icon: const Icon(Icons.merge_type),
                      label: Text(t('resolve')),
                    ),
                  ],
                ],
              ),
  );

  Widget _field(TextEditingController controller, String key, int lines) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: TextField(controller: controller, maxLines: lines, decoration: InputDecoration(labelText: t(key), border: const OutlineInputBorder())),
  );

  Widget _numberField(TextEditingController controller, String key) => SizedBox(
    width: 165,
    child: TextField(
      controller: controller,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      decoration: InputDecoration(labelText: t(key), border: const OutlineInputBorder()),
    ),
  );

  String? _text(TextEditingController controller) {
    final value = controller.text.trim();
    return value.isEmpty ? null : value;
  }

  num? _number(TextEditingController controller) {
    final value = controller.text.trim();
    return value.isEmpty ? null : num.tryParse(value);
  }

  void _message(String value, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value), backgroundColor: error ? const Color(0xFFB91C1C) : null));
  }
}

String doctorOfflineClinicalDraftText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Offline clinical draft','subtitle':'Encrypted HOME_VISIT draft','safety':'This is a temporary draft only. Synchronization never writes or finalizes the clinical record automatically. Conflicts require explicit review.','state':'State','expires':'Expires','saveLocal':'Save encrypted locally','sync':'Synchronize draft','resolve':'Resolve conflict','cancel':'Cancel','keepServer':'Keep server draft','useLocal':'Use local draft','conflictBody':'Nothing is overwritten automatically. Choose the version to preserve after reviewing both sides.','saved':'Encrypted draft saved locally for up to 72 hours.','synced':'Draft synchronized.','conflictCreated':'A version conflict was preserved for explicit review.','chiefComplaint':'Chief complaint','subjective':'Subjective','objective':'Objective','assessment':'Assessment','plan':'Plan','vitals':'Vitals','heartRate':'Heart rate','systolic':'Systolic','diastolic':'Diastolic','oxygen':'SpO₂','temperature':'Temperature °C','respiratoryRate':'Respiratory rate','weight':'Weight kg','painScore':'Pain score'
    },
    CarePointLocale.ar: {
      'title':'مسودة سريرية دون اتصال','subtitle':'مسودة زيارة منزلية مشفرة','safety':'هذه مسودة مؤقتة فقط. المزامنة لا تكتب أو تغلق السجل السريري تلقائياً، والتعارضات تتطلب مراجعة صريحة.','state':'الحالة','expires':'تنتهي','saveLocal':'حفظ مشفر محلياً','sync':'مزامنة المسودة','resolve':'حل التعارض','cancel':'إلغاء','keepServer':'الاحتفاظ بمسودة الخادم','useLocal':'استخدام المسودة المحلية','conflictBody':'لا تتم الكتابة فوق أي نسخة تلقائياً. اختر النسخة بعد مراجعة الطرفين.','saved':'تم حفظ المسودة مشفرة محلياً لمدة تصل إلى 72 ساعة.','synced':'تمت مزامنة المسودة.','conflictCreated':'تم حفظ تعارض الإصدارات للمراجعة الصريحة.','chiefComplaint':'الشكوى الرئيسية','subjective':'ذاتي','objective':'موضوعي','assessment':'التقييم','plan':'الخطة','vitals':'العلامات الحيوية','heartRate':'النبض','systolic':'الضغط الانقباضي','diastolic':'الضغط الانبساطي','oxygen':'SpO₂','temperature':'الحرارة °C','respiratoryRate':'معدل التنفس','weight':'الوزن كغ','painScore':'درجة الألم'
    },
    CarePointLocale.fr: {
      'title':'Brouillon clinique hors ligne','subtitle':'Brouillon chiffré de visite à domicile','safety':'Brouillon temporaire uniquement. La synchronisation n’écrit ni ne finalise automatiquement le dossier clinique; tout conflit exige un choix explicite.','state':'État','expires':'Expire','saveLocal':'Enregistrer chiffré localement','sync':'Synchroniser le brouillon','resolve':'Résoudre le conflit','cancel':'Annuler','keepServer':'Garder le brouillon serveur','useLocal':'Utiliser le brouillon local','conflictBody':'Rien n’est écrasé automatiquement. Choisissez la version à conserver après examen.','saved':'Brouillon chiffré enregistré localement pour 72 heures maximum.','synced':'Brouillon synchronisé.','conflictCreated':'Un conflit de version a été conservé pour examen.','chiefComplaint':'Motif principal','subjective':'Subjectif','objective':'Objectif','assessment':'Évaluation','plan':'Plan','vitals':'Constantes','heartRate':'Fréquence cardiaque','systolic':'Systolique','diastolic':'Diastolique','oxygen':'SpO₂','temperature':'Température °C','respiratoryRate':'Fréquence respiratoire','weight':'Poids kg','painScore':'Douleur'
    },
    CarePointLocale.es: {
      'title':'Borrador clínico offline','subtitle':'Borrador cifrado de visita domiciliaria','safety':'Es sólo un borrador temporal. La sincronización nunca escribe ni finaliza automáticamente la historia clínica; los conflictos requieren revisión explícita.','state':'Estado','expires':'Caduca','saveLocal':'Guardar cifrado localmente','sync':'Sincronizar borrador','resolve':'Resolver conflicto','cancel':'Cancelar','keepServer':'Conservar borrador del servidor','useLocal':'Usar borrador local','conflictBody':'Nada se sobrescribe automáticamente. Elige la versión a conservar tras revisar ambas.','saved':'Borrador cifrado guardado localmente hasta 72 horas.','synced':'Borrador sincronizado.','conflictCreated':'Se conservó un conflicto de versión para revisión explícita.','chiefComplaint':'Motivo principal','subjective':'Subjetivo','objective':'Objetivo','assessment':'Evaluación','plan':'Plan','vitals':'Constantes','heartRate':'Frecuencia cardiaca','systolic':'Sistólica','diastolic':'Diastólica','oxygen':'SpO₂','temperature':'Temperatura °C','respiratoryRate':'Frecuencia respiratoria','weight':'Peso kg','painScore':'Dolor'
    },
  };
  return values[locale]?[key] ?? values[CarePointLocale.en]![key] ?? key;
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return const {};
}

String _value(dynamic value) => value == null ? '' : value.toString();
String _date(DateTime value) => value.toLocal().toString().substring(0, 16);
String _newDoctorDraftId() {
  final random = Random.secure();
  final suffix = List.generate(8, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  return 'doctor-draft-${DateTime.now().microsecondsSinceEpoch}-$suffix';
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
