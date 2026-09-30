import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'provider_offline_sync_api.dart';

String providerOfflineDraftText(CarePointLocale locale, String key) {
  const values = <String, Map<String, String>>{
    'title': {'en': 'Offline field drafts', 'ar': 'مسودات العمل الميداني دون اتصال', 'fr': 'Brouillons terrain hors ligne', 'es': 'Borradores de campo sin conexión'},
    'subtitle': {'en': 'Checklist, notes and evidence references stay encrypted on this device until synchronization.', 'ar': 'تبقى قائمة التحقق والملاحظات ومراجع الأدلة مشفرة على هذا الجهاز حتى المزامنة.', 'fr': 'La checklist, les notes et les références de preuve restent chiffrées sur cet appareil jusqu’à la synchronisation.', 'es': 'La lista, las notas y las referencias de evidencia permanecen cifradas en este dispositivo hasta sincronizar.'},
    'newDraft': {'en': 'Create offline draft', 'ar': 'إنشاء مسودة دون اتصال', 'fr': 'Créer un brouillon hors ligne', 'es': 'Crear borrador offline'},
    'edit': {'en': 'Edit locally', 'ar': 'تعديل محلي', 'fr': 'Modifier localement', 'es': 'Editar localmente'},
    'sync': {'en': 'Sync now', 'ar': 'مزامنة الآن', 'fr': 'Synchroniser', 'es': 'Sincronizar ahora'},
    'resolve': {'en': 'Resolve conflict', 'ar': 'حل التعارض', 'fr': 'Résoudre le conflit', 'es': 'Resolver conflicto'},
    'pending': {'en': 'Pending sync', 'ar': 'بانتظار المزامنة', 'fr': 'Synchronisation en attente', 'es': 'Pendiente de sincronizar'},
    'synced': {'en': 'Synced', 'ar': 'تمت المزامنة', 'fr': 'Synchronisé', 'es': 'Sincronizado'},
    'conflict': {'en': 'Conflict needs review', 'ar': 'التعارض يحتاج مراجعة', 'fr': 'Conflit à examiner', 'es': 'Conflicto pendiente de revisión'},
    'appointment': {'en': 'Home visit', 'ar': 'زيارة منزلية', 'fr': 'Visite à domicile', 'es': 'Visita domiciliaria'},
    'serverVersion': {'en': 'Server version', 'ar': 'إصدار الخادم', 'fr': 'Version serveur', 'es': 'Versión del servidor'},
    'localRevision': {'en': 'Local revision', 'ar': 'المراجعة المحلية', 'fr': 'Révision locale', 'es': 'Revisión local'},
    'noVisits': {'en': 'No confirmed or completed home visits are available.', 'ar': 'لا توجد زيارات منزلية مؤكدة أو مكتملة.', 'fr': 'Aucune visite à domicile confirmée ou terminée.', 'es': 'No hay visitas domiciliarias confirmadas o completadas.'},
    'notes': {'en': 'Field notes', 'ar': 'ملاحظات ميدانية', 'fr': 'Notes terrain', 'es': 'Notas de campo'},
    'evidenceRefs': {'en': 'Encrypted evidence references', 'ar': 'مراجع الأدلة المشفرة', 'fr': 'Références de preuve chiffrées', 'es': 'Referencias de evidencia cifradas'},
    'evidenceHint': {'en': 'Opaque IDs only, separated by commas or new lines', 'ar': 'معرّفات غير مكشوفة فقط، مفصولة بفواصل أو أسطر', 'fr': 'Identifiants opaques uniquement, séparés par virgules ou lignes', 'es': 'Solo IDs opacos, separados por comas o líneas'},
    'arrivalReady': {'en': 'Arrival context checked', 'ar': 'تم التحقق من سياق الوصول', 'fr': 'Contexte d’arrivée vérifié', 'es': 'Contexto de llegada revisado'},
    'checklistReviewed': {'en': 'Required checklist reviewed', 'ar': 'تمت مراجعة قائمة التحقق المطلوبة', 'fr': 'Checklist requise vérifiée', 'es': 'Lista requerida revisada'},
    'evidenceReviewed': {'en': 'Evidence references reviewed', 'ar': 'تمت مراجعة مراجع الأدلة', 'fr': 'Références de preuve vérifiées', 'es': 'Referencias de evidencia revisadas'},
    'saveLocal': {'en': 'Save encrypted locally', 'ar': 'حفظ مشفر محلياً', 'fr': 'Enregistrer chiffré localement', 'es': 'Guardar cifrado localmente'},
    'cancel': {'en': 'Cancel', 'ar': 'إلغاء', 'fr': 'Annuler', 'es': 'Cancelar'},
    'keepServer': {'en': 'Keep server version', 'ar': 'الاحتفاظ بإصدار الخادم', 'fr': 'Garder la version serveur', 'es': 'Conservar versión del servidor'},
    'useLocal': {'en': 'Use local draft', 'ar': 'استخدام المسودة المحلية', 'fr': 'Utiliser le brouillon local', 'es': 'Usar borrador local'},
    'conflictTitle': {'en': 'Choose conflict resolution', 'ar': 'اختر حل التعارض', 'fr': 'Choisir la résolution du conflit', 'es': 'Elegir resolución del conflicto'},
    'conflictBody': {'en': 'Nothing is overwritten automatically. The conflicting encrypted copy remains in the server audit trail after resolution.', 'ar': 'لا تتم الكتابة فوق أي شيء تلقائياً. تبقى النسخة المتعارضة المشفرة في سجل الخادم بعد الحل.', 'fr': 'Rien n’est écrasé automatiquement. La copie chiffrée en conflit reste dans la trace serveur après résolution.', 'es': 'Nada se sobrescribe automáticamente. La copia cifrada en conflicto permanece en el registro del servidor tras resolverlo.'},
    'refresh': {'en': 'Refresh', 'ar': 'تحديث', 'fr': 'Actualiser', 'es': 'Actualizar'},
    'saved': {'en': 'Encrypted draft saved locally.', 'ar': 'تم حفظ المسودة مشفرة محلياً.', 'fr': 'Brouillon chiffré enregistré localement.', 'es': 'Borrador cifrado guardado localmente.'},
    'syncOk': {'en': 'Draft synchronized.', 'ar': 'تمت مزامنة المسودة.', 'fr': 'Brouillon synchronisé.', 'es': 'Borrador sincronizado.'},
    'conflictCreated': {'en': 'A server conflict was preserved for explicit review.', 'ar': 'تم حفظ تعارض الخادم للمراجعة الصريحة.', 'fr': 'Un conflit serveur a été conservé pour examen explicite.', 'es': 'Se conservó un conflicto del servidor para revisión explícita.'},
  };
  final language = switch (locale) {
    CarePointLocale.ar => 'ar',
    CarePointLocale.fr => 'fr',
    CarePointLocale.es => 'es',
    _ => 'en',
  };
  return values[key]?[language] ?? values[key]?['en'] ?? key;
}

class OfflineFieldDraftLocal {
  const OfflineFieldDraftLocal({
    required this.clientDraftId,
    required this.appointmentId,
    required this.serverVersion,
    required this.clientRevision,
    required this.checklist,
    required this.notes,
    required this.evidenceRefs,
    required this.updatedAt,
    required this.state,
    this.conflictId,
  });

  final String clientDraftId;
  final String appointmentId;
  final int serverVersion;
  final int clientRevision;
  final Map<String, dynamic> checklist;
  final String? notes;
  final List<String> evidenceRefs;
  final DateTime updatedAt;
  final String state;
  final String? conflictId;

  OfflineFieldDraftLocal copyWith({
    int? serverVersion,
    int? clientRevision,
    Map<String, dynamic>? checklist,
    String? notes,
    bool clearNotes = false,
    List<String>? evidenceRefs,
    DateTime? updatedAt,
    String? state,
    String? conflictId,
    bool clearConflict = false,
  }) =>
      OfflineFieldDraftLocal(
        clientDraftId: clientDraftId,
        appointmentId: appointmentId,
        serverVersion: serverVersion ?? this.serverVersion,
        clientRevision: clientRevision ?? this.clientRevision,
        checklist: checklist ?? this.checklist,
        notes: clearNotes ? null : (notes ?? this.notes),
        evidenceRefs: evidenceRefs ?? this.evidenceRefs,
        updatedAt: updatedAt ?? this.updatedAt,
        state: state ?? this.state,
        conflictId: clearConflict ? null : (conflictId ?? this.conflictId),
      );

  Map<String, dynamic> toJson() => {
        'clientDraftId': clientDraftId,
        'appointmentId': appointmentId,
        'serverVersion': serverVersion,
        'clientRevision': clientRevision,
        'checklist': checklist,
        'notes': notes,
        'evidenceRefs': evidenceRefs,
        'updatedAt': updatedAt.toUtc().toIso8601String(),
        'state': state,
        'conflictId': conflictId,
      };

  static OfflineFieldDraftLocal? fromJson(dynamic value) {
    if (value is! Map) return null;
    final map = value.map((key, item) => MapEntry(key.toString(), item));
    final clientDraftId = map['clientDraftId']?.toString() ?? '';
    final appointmentId = map['appointmentId']?.toString() ?? '';
    if (clientDraftId.isEmpty || appointmentId.isEmpty) return null;
    final checklistValue = map['checklist'];
    final checklist = checklistValue is Map
        ? checklistValue.map((key, item) => MapEntry(key.toString(), item))
        : <String, dynamic>{};
    final evidence = map['evidenceRefs'];
    return OfflineFieldDraftLocal(
      clientDraftId: clientDraftId,
      appointmentId: appointmentId,
      serverVersion: int.tryParse('${map['serverVersion'] ?? 0}') ?? 0,
      clientRevision: int.tryParse('${map['clientRevision'] ?? 1}') ?? 1,
      checklist: checklist,
      notes: map['notes']?.toString(),
      evidenceRefs: evidence is List ? evidence.map((item) => item.toString()).toList(growable: false) : const [],
      updatedAt: DateTime.tryParse(map['updatedAt']?.toString() ?? '') ?? DateTime.now().toUtc(),
      state: map['state']?.toString() ?? 'PENDING',
      conflictId: map['conflictId']?.toString(),
    );
  }
}

class ProviderOfflineDraftStore {
  ProviderOfflineDraftStore(String accountId, {FlutterSecureStorage? storage})
      : _key = 'carepoint.provider.offline_drafts.$accountId',
        _storage = storage ?? const FlutterSecureStorage();

  final String _key;
  final FlutterSecureStorage _storage;

  Future<List<OfflineFieldDraftLocal>> load() async {
    final encoded = await _storage.read(key: _key);
    if (encoded == null || encoded.isEmpty) return [];
    try {
      final decoded = jsonDecode(encoded);
      if (decoded is! List) return [];
      return decoded.map(OfflineFieldDraftLocal.fromJson).whereType<OfflineFieldDraftLocal>().toList(growable: true);
    } catch (_) {
      return [];
    }
  }

  Future<void> save(OfflineFieldDraftLocal draft) async {
    final drafts = await load();
    final index = drafts.indexWhere((item) => item.clientDraftId == draft.clientDraftId);
    if (index < 0) {
      drafts.add(draft);
    } else {
      drafts[index] = draft;
    }
    await _storage.write(
      key: _key,
      value: jsonEncode(drafts.map((item) => item.toJson()).toList(growable: false)),
    );
  }
}

class ProviderOfflineDraftsPage extends StatefulWidget {
  const ProviderOfflineDraftsPage({super.key, required this.session, required this.locale, required this.accent});

  final CarePointSession session;
  final CarePointLocale locale;
  final Color accent;

  @override
  State<ProviderOfflineDraftsPage> createState() => _ProviderOfflineDraftsPageState();
}

class _ProviderOfflineDraftsPageState extends State<ProviderOfflineDraftsPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> visits = const [];
  List<OfflineFieldDraftLocal> drafts = const [];
  late final ProviderOfflineDraftStore store;

  @override
  void initState() {
    super.initState();
    final accountId = widget.session.account['id']?.toString() ?? widget.session.account['email']?.toString() ?? 'provider';
    store = ProviderOfflineDraftStore(accountId);
    refresh();
  }

  Future<void> refresh() async {
    if (mounted) setState(() { loading = true; error = null; });
    try {
      final results = await Future.wait<dynamic>([
        widget.session.api.providerAppointments(),
        store.load(),
        widget.session.api.offlineFieldSyncConflicts(),
      ]);
      final appointments = (results[0] as List<Map<String, dynamic>>)
          .where((item) => item['modality']?.toString() == 'HOME_VISIT' && {'CONFIRMED', 'COMPLETED'}.contains(item['status']?.toString()))
          .toList(growable: false);
      final local = List<OfflineFieldDraftLocal>.from(results[1] as List<OfflineFieldDraftLocal>);
      for (final conflict in results[2] as List<Map<String, dynamic>>) {
        final index = local.indexWhere((item) => item.clientDraftId == conflict['clientDraftId']?.toString());
        if (index < 0) continue;
        final updated = local[index].copyWith(state: 'CONFLICT', conflictId: conflict['id']?.toString());
        local[index] = updated;
        await store.save(updated);
      }
      if (mounted) setState(() { visits = appointments; drafts = local; });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(providerOfflineDraftText(widget.locale, 'title')),
          actions: [IconButton(onPressed: refresh, tooltip: providerOfflineDraftText(widget.locale, 'refresh'), icon: const Icon(Icons.refresh_rounded))],
        ),
        body: RefreshIndicator(
          onRefresh: refresh,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(providerOfflineDraftText(widget.locale, 'subtitle'), style: const TextStyle(color: Color(0xFF64748B))),
              const SizedBox(height: 12),
              if (loading) const LinearProgressIndicator(),
              if (error != null)
                Card(child: Padding(padding: const EdgeInsets.all(14), child: Text(error!, style: const TextStyle(color: Color(0xFFB91C1C))))),
              if (!loading && visits.isEmpty)
                Card(child: Padding(padding: const EdgeInsets.all(18), child: Text(providerOfflineDraftText(widget.locale, 'noVisits')))),
              ...visits.map(_visitCard),
            ],
          ),
        ),
      );

  Widget _visitCard(Map<String, dynamic> visit) {
    final appointmentId = visit['id']?.toString() ?? '';
    final draft = _draftForAppointment(appointmentId);
    final startsAt = DateTime.tryParse(visit['startsAt']?.toString() ?? '')?.toLocal();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            const Icon(Icons.home_work_outlined),
            const SizedBox(width: 10),
            Expanded(child: Text('${providerOfflineDraftText(widget.locale, 'appointment')} · ${_date(startsAt)}', style: const TextStyle(fontWeight: FontWeight.w900))),
            if (draft != null) _stateChip(draft.state),
          ]),
          const SizedBox(height: 6),
          Text('${visit['status'] ?? ''} · $appointmentId', style: const TextStyle(color: Color(0xFF64748B))),
          if (draft != null) ...[
            const SizedBox(height: 8),
            Text('${providerOfflineDraftText(widget.locale, 'serverVersion')}: ${draft.serverVersion} · ${providerOfflineDraftText(widget.locale, 'localRevision')}: ${draft.clientRevision}'),
          ],
          const SizedBox(height: 12),
          Wrap(spacing: 8, runSpacing: 8, children: [
            OutlinedButton.icon(
              onPressed: () => _edit(appointmentId, draft),
              icon: Icon(draft == null ? Icons.note_add_outlined : Icons.edit_note),
              label: Text(providerOfflineDraftText(widget.locale, draft == null ? 'newDraft' : 'edit')),
            ),
            if (draft != null && draft.state == 'PENDING')
              FilledButton.icon(onPressed: () => _sync(draft), icon: const Icon(Icons.sync), label: Text(providerOfflineDraftText(widget.locale, 'sync'))),
            if (draft?.state == 'CONFLICT' && draft?.conflictId != null)
              FilledButton.tonalIcon(onPressed: () => _resolve(draft!), icon: const Icon(Icons.merge_type), label: Text(providerOfflineDraftText(widget.locale, 'resolve'))),
          ]),
        ]),
      ),
    );
  }

  Widget _stateChip(String state) {
    final key = switch (state) { 'SYNCED' => 'synced', 'CONFLICT' => 'conflict', _ => 'pending' };
    final icon = switch (state) { 'SYNCED' => Icons.cloud_done_outlined, 'CONFLICT' => Icons.sync_problem_outlined, _ => Icons.cloud_upload_outlined };
    return Chip(avatar: Icon(icon, size: 17), label: Text(providerOfflineDraftText(widget.locale, key)));
  }

  OfflineFieldDraftLocal? _draftForAppointment(String appointmentId) {
    for (final draft in drafts) {
      if (draft.appointmentId == appointmentId) return draft;
    }
    return null;
  }

  Future<void> _edit(String appointmentId, OfflineFieldDraftLocal? current) async {
    final result = await Navigator.of(context).push<OfflineFieldDraftLocal>(MaterialPageRoute(
      builder: (_) => Directionality(
        textDirection: widget.locale.textDirection,
        child: _OfflineDraftEditorPage(locale: widget.locale, accent: widget.accent, appointmentId: appointmentId, draft: current),
      ),
    ));
    if (result == null) return;
    await store.save(result);
    if (mounted) _message(providerOfflineDraftText(widget.locale, 'saved'));
    await refresh();
  }

  Future<void> _sync(OfflineFieldDraftLocal draft) async {
    try {
      final result = await widget.session.api.syncOfflineFieldDraft({
        'appointmentId': draft.appointmentId,
        'clientDraftId': draft.clientDraftId,
        'clientRevision': draft.clientRevision,
        'baseServerVersion': draft.serverVersion,
        'idempotencyKey': 'offline:${draft.clientDraftId}:${draft.clientRevision}',
        'checklist': draft.checklist,
        'notes': draft.notes,
        'evidenceRefs': draft.evidenceRefs,
        'clientUpdatedAt': draft.updatedAt.toUtc().toIso8601String(),
      });
      final isConflict = result['outcome'] == 'CONFLICT';
      final updated = draft.copyWith(
        serverVersion: isConflict ? null : int.tryParse('${result['serverVersion'] ?? draft.serverVersion}'),
        state: isConflict ? 'CONFLICT' : 'SYNCED',
        conflictId: isConflict ? result['conflictId']?.toString() : null,
        clearConflict: !isConflict,
      );
      await store.save(updated);
      if (mounted) _message(providerOfflineDraftText(widget.locale, isConflict ? 'conflictCreated' : 'syncOk'));
      await refresh();
    } catch (value) {
      if (mounted) _message(value.toString(), error: true);
    }
  }

  Future<void> _resolve(OfflineFieldDraftLocal draft) async {
    final conflictId = draft.conflictId;
    if (conflictId == null) return;
    try {
      final detail = await widget.session.api.offlineFieldSyncConflict(conflictId);
      if (!mounted) return;
      final resolution = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(providerOfflineDraftText(widget.locale, 'conflictTitle')),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(providerOfflineDraftText(widget.locale, 'conflictBody')),
            const SizedBox(height: 12),
            Text('${providerOfflineDraftText(widget.locale, 'localRevision')}: ${detail['clientRevision'] ?? draft.clientRevision}'),
            Text('${providerOfflineDraftText(widget.locale, 'serverVersion')}: ${detail['currentServerVersion'] ?? draft.serverVersion}'),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: Text(providerOfflineDraftText(widget.locale, 'cancel'))),
            OutlinedButton(onPressed: () => Navigator.pop(context, 'KEEP_SERVER'), child: Text(providerOfflineDraftText(widget.locale, 'keepServer'))),
            FilledButton(onPressed: () => Navigator.pop(context, 'USE_CLIENT'), child: Text(providerOfflineDraftText(widget.locale, 'useLocal'))),
          ],
        ),
      );
      if (resolution == null) return;
      final result = await widget.session.api.resolveOfflineFieldSyncConflict(conflictId, resolution: resolution);
      var updated = draft.copyWith(
        serverVersion: int.tryParse('${result['serverVersion'] ?? draft.serverVersion}') ?? draft.serverVersion,
        state: 'SYNCED',
        clearConflict: true,
      );
      if (resolution == 'KEEP_SERVER' && result['serverSnapshot'] is Map) {
        final server = (result['serverSnapshot'] as Map).map((key, item) => MapEntry(key.toString(), item));
        final checklistValue = server['checklist'];
        final evidenceValue = server['evidenceRefs'];
        updated = updated.copyWith(
          checklist: checklistValue is Map ? checklistValue.map((key, item) => MapEntry(key.toString(), item)) : <String, dynamic>{},
          notes: server['notes']?.toString(),
          clearNotes: server['notes'] == null,
          evidenceRefs: evidenceValue is List ? evidenceValue.map((item) => item.toString()).toList(growable: false) : const [],
          updatedAt: DateTime.now().toUtc(),
        );
      }
      await store.save(updated);
      if (mounted) _message(providerOfflineDraftText(widget.locale, 'syncOk'));
      await refresh();
    } catch (value) {
      if (mounted) _message(value.toString(), error: true);
    }
  }

  String _date(DateTime? value) {
    if (value == null) return '—';
    String two(int number) => number.toString().padLeft(2, '0');
    return '${value.year}-${two(value.month)}-${two(value.day)} ${two(value.hour)}:${two(value.minute)}';
  }

  void _message(String text, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text), backgroundColor: error ? const Color(0xFFB91C1C) : null));
  }
}

class _OfflineDraftEditorPage extends StatefulWidget {
  const _OfflineDraftEditorPage({required this.locale, required this.accent, required this.appointmentId, this.draft});
  final CarePointLocale locale;
  final Color accent;
  final String appointmentId;
  final OfflineFieldDraftLocal? draft;

  @override
  State<_OfflineDraftEditorPage> createState() => _OfflineDraftEditorPageState();
}

class _OfflineDraftEditorPageState extends State<_OfflineDraftEditorPage> {
  late final TextEditingController notes;
  late final TextEditingController evidence;
  late Map<String, dynamic> checklist;

  @override
  void initState() {
    super.initState();
    notes = TextEditingController(text: widget.draft?.notes ?? '');
    evidence = TextEditingController(text: widget.draft?.evidenceRefs.join('\n') ?? '');
    checklist = Map<String, dynamic>.from(widget.draft?.checklist ?? const {});
  }

  @override
  void dispose() {
    notes.dispose();
    evidence.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(providerOfflineDraftText(widget.locale, 'title'))),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _check('ARRIVAL_CONTEXT_READY', 'arrivalReady'),
            _check('REQUIRED_CHECKLIST_REVIEWED', 'checklistReviewed'),
            _check('EVIDENCE_REFERENCES_REVIEWED', 'evidenceReviewed'),
            const SizedBox(height: 14),
            TextField(controller: notes, minLines: 4, maxLines: 10, decoration: InputDecoration(labelText: providerOfflineDraftText(widget.locale, 'notes'), border: const OutlineInputBorder())),
            const SizedBox(height: 14),
            TextField(
              controller: evidence,
              minLines: 2,
              maxLines: 6,
              decoration: InputDecoration(labelText: providerOfflineDraftText(widget.locale, 'evidenceRefs'), helperText: providerOfflineDraftText(widget.locale, 'evidenceHint'), border: const OutlineInputBorder()),
            ),
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: _save,
              icon: const Icon(Icons.lock_outline),
              label: Text(providerOfflineDraftText(widget.locale, 'saveLocal')),
              style: FilledButton.styleFrom(backgroundColor: widget.accent, minimumSize: const Size.fromHeight(50)),
            ),
          ],
        ),
      );

  Widget _check(String code, String textKey) => CheckboxListTile(
        contentPadding: EdgeInsets.zero,
        title: Text(providerOfflineDraftText(widget.locale, textKey)),
        value: checklist[code] == true,
        onChanged: (value) => setState(() => checklist[code] = value == true),
      );

  void _save() {
    final now = DateTime.now().toUtc();
    final current = widget.draft;
    final refs = evidence.text.split(RegExp(r'[,\n]')).map((item) => item.trim()).where((item) => item.isNotEmpty).toSet().toList(growable: false);
    Navigator.pop(
      context,
      OfflineFieldDraftLocal(
        clientDraftId: current?.clientDraftId ?? _newClientDraftId(),
        appointmentId: widget.appointmentId,
        serverVersion: current?.serverVersion ?? 0,
        clientRevision: (current?.clientRevision ?? 0) + 1,
        checklist: Map<String, dynamic>.from(checklist),
        notes: notes.text.trim().isEmpty ? null : notes.text.trim(),
        evidenceRefs: refs,
        updatedAt: now,
        state: 'PENDING',
      ),
    );
  }
}

String _newClientDraftId() {
  final random = Random.secure();
  final suffix = List.generate(8, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  return 'draft-${DateTime.now().microsecondsSinceEpoch}-$suffix';
}
