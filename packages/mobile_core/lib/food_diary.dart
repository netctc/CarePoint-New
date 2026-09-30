import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class PatientFoodDiaryPage extends StatefulWidget {
  const PatientFoodDiaryPage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientFoodDiaryPage> createState() => _PatientFoodDiaryPageState();
}

class _PatientFoodDiaryPageState extends State<PatientFoodDiaryPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> items = const [];

  String t(String key) => foodDiaryText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final result = await widget.session.api.patientFoodDiary();
      if (mounted) setState(() => items = _maps(result['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _add() async {
    String mealType = 'BREAKFAST';
    bool shared = false;
    final description = TextEditingController();
    final notes = TextEditingController();
    String? validation;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: Text(t('add')),
          content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
            DropdownButtonFormField<String>(
              initialValue: mealType,
              decoration: InputDecoration(labelText: t('mealType')),
              items: const ['BREAKFAST','LUNCH','DINNER','SNACK','OTHER']
                  .map((value) => DropdownMenuItem(value: value, child: Text(t(value)))).toList(),
              onChanged: (value) => setLocal(() => mealType = value ?? mealType),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: description,
              maxLines: 4,
              decoration: InputDecoration(labelText: t('description'), border: const OutlineInputBorder()),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: notes,
              maxLines: 3,
              decoration: InputDecoration(labelText: t('notes'), border: const OutlineInputBorder()),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(t('shareNow')),
              subtitle: Text(t('shareHint')),
              value: shared,
              onChanged: (value) => setLocal(() => shared = value),
            ),
            if (validation != null)
              Text(validation!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ])),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
            FilledButton(onPressed: () {
              if (description.text.trim().isEmpty) {
                setLocal(() => validation = t('descriptionRequired'));
                return;
              }
              Navigator.pop(dialogContext, true);
            }, child: Text(t('save'))),
          ],
        ),
      ),
    );
    if (accepted == true) {
      try {
        await widget.session.api.createPatientFoodDiaryEntry(
          mealAt: DateTime.now(),
          mealType: mealType,
          description: description.text.trim(),
          notes: notes.text.trim(),
          shared: shared,
          idempotencyKey: 'food-${DateTime.now().microsecondsSinceEpoch}',
        );
        await _load();
      } catch (value) {
        _message(value.toString());
      }
    }
    description.dispose();
    notes.dispose();
  }

  Future<void> _toggle(Map<String, dynamic> item, bool shared) async {
    try {
      await widget.session.api.setPatientFoodDiarySharing(
        item['id'].toString(),
        expectedVersion: _int(item['version'], 1),
        shared: shared,
      );
      await _load();
    } catch (value) {
      _message(value.toString());
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(t('patientTitle')),
      actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))],
    ),
    floatingActionButton: FloatingActionButton.extended(
      key: const ValueKey('patient-food-diary-add'),
      onPressed: _add,
      icon: const Icon(Icons.add),
      label: Text(t('add')),
    ),
    body: loading
        ? const Center(child: CircularProgressIndicator())
        : error != null
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
            : RefreshIndicator(
                onRefresh: _load,
                child: items.isEmpty
                    ? ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Text(t('empty'), textAlign: TextAlign.center))])
                    : ListView.builder(
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
                        itemCount: items.length,
                        itemBuilder: (_, index) => _patientCard(items[index]),
                      ),
              ),
  );

  Widget _patientCard(Map<String, dynamic> item) {
    final data = _map(item['data']);
    final comments = _maps(item['comments']);
    final shared = item['shared'] == true;
    return Card(child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.restaurant_outlined),
          title: Text(t(item['mealType']?.toString() ?? 'OTHER'), style: const TextStyle(fontWeight: FontWeight.w800)),
          subtitle: Text('${_dateTime(item['mealAt'])}\n${data['description'] ?? ''}${data['notes']?.toString().isNotEmpty == true ? '\n${data['notes']}' : ''}'),
          isThreeLine: true,
        ),
        SwitchListTile(
          key: ValueKey('patient-food-diary-share-${item['id']}'),
          contentPadding: EdgeInsets.zero,
          title: Text(t('shared')),
          subtitle: Text(shared ? t('sharedOn') : t('sharedOff')),
          value: shared,
          onChanged: (value) => _toggle(item, value),
        ),
        if (comments.isNotEmpty) ...[
          const Divider(),
          Text(t('professionalComments'), style: const TextStyle(fontWeight: FontWeight.w800)),
          ...comments.map((comment) {
            final commentData = _map(comment['data']);
            return ListTile(
              dense: true,
              leading: const Icon(Icons.medical_information_outlined),
              title: Text(commentData['comment']?.toString() ?? ''),
              subtitle: Text(_dateTime(comment['createdAt'])),
            );
          }),
        ],
      ]),
    ));
  }

  void _message(String value) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }
}

class ProviderFoodDiaryPage extends StatefulWidget {
  const ProviderFoodDiaryPage({
    super.key,
    required this.session,
    required this.locale,
    required this.appointment,
  });
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;

  @override
  State<ProviderFoodDiaryPage> createState() => _ProviderFoodDiaryPageState();
}

class _ProviderFoodDiaryPageState extends State<ProviderFoodDiaryPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> items = const [];

  String t(String key) => foodDiaryText(widget.locale, key);
  String get patientId => _map(widget.appointment['patient'])['id']?.toString() ?? '';
  String get appointmentId => widget.appointment['id']?.toString() ?? '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final result = await widget.session.api.providerFoodDiary(patientId, appointmentId);
      if (mounted) setState(() => items = _maps(result['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _comment(Map<String, dynamic> item) async {
    final controller = TextEditingController();
    String? validation;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: Text(t('addComment')),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(t('commentImmutable'), style: const TextStyle(color: Color(0xFF64748B))),
            const SizedBox(height: 10),
            TextField(
              controller: controller,
              maxLines: 4,
              decoration: InputDecoration(labelText: t('comment'), border: const OutlineInputBorder()),
            ),
            if (validation != null)
              Padding(padding: const EdgeInsets.only(top: 8), child: Text(validation!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
            FilledButton(onPressed: () {
              if (controller.text.trim().isEmpty) {
                setLocal(() => validation = t('commentRequired'));
                return;
              }
              Navigator.pop(dialogContext, true);
            }, child: Text(t('save'))),
          ],
        ),
      ),
    );
    if (accepted == true) {
      try {
        await widget.session.api.addProviderFoodDiaryComment(
          item['id'].toString(),
          appointmentId: appointmentId,
          comment: controller.text.trim(),
          idempotencyKey: 'food-comment-${DateTime.now().microsecondsSinceEpoch}',
        );
        await _load();
      } catch (value) {
        _message(value.toString());
      }
    }
    controller.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(t('providerTitle')),
      actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))],
    ),
    body: loading
        ? const Center(child: CircularProgressIndicator())
        : error != null
            ? Center(child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.lock_outline, size: 36),
                  const SizedBox(height: 10),
                  Text(error!, textAlign: TextAlign.center),
                  const SizedBox(height: 8),
                  Text(t('consentHint'), textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF64748B))),
                ]),
              ))
            : RefreshIndicator(
                onRefresh: _load,
                child: items.isEmpty
                    ? ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Text(t('providerEmpty'), textAlign: TextAlign.center))])
                    : ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: items.length,
                        itemBuilder: (_, index) => _providerCard(items[index]),
                      ),
              ),
  );

  Widget _providerCard(Map<String, dynamic> item) {
    final data = _map(item['data']);
    final comments = _maps(item['comments']);
    return Card(child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.restaurant_menu_outlined),
          title: Text(t(item['mealType']?.toString() ?? 'OTHER'), style: const TextStyle(fontWeight: FontWeight.w800)),
          subtitle: Text('${_dateTime(item['mealAt'])}\n${data['description'] ?? ''}${data['notes']?.toString().isNotEmpty == true ? '\n${data['notes']}' : ''}'),
          isThreeLine: true,
        ),
        Text(t('sharedReadOnly'), style: const TextStyle(color: Color(0xFF64748B))),
        if (comments.isNotEmpty) ...[
          const Divider(),
          ...comments.map((comment) => ListTile(
            dense: true,
            leading: const Icon(Icons.comment_outlined),
            title: Text(_map(comment['data'])['comment']?.toString() ?? ''),
            subtitle: Text(_dateTime(comment['createdAt'])),
          )),
        ],
        const SizedBox(height: 8),
        FilledButton.tonalIcon(
          key: ValueKey('provider-food-diary-comment-${item['id']}'),
          onPressed: () => _comment(item),
          icon: const Icon(Icons.add_comment_outlined),
          label: Text(t('addComment')),
        ),
      ]),
    ));
  }

  void _message(String value) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }
}

String foodDiaryText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'patientTitle':'Food diary','providerTitle':'Shared food diary','add':'Add meal','mealType':'Meal type',
      'description':'What did you eat or drink?','notes':'Optional notes','shareNow':'Share with care team',
      'shareHint':'Sharing an entry does not grant access by itself; the target provider also needs active consent.',
      'shared':'Shared entry','sharedOn':'Visible only to consented providers with a current care relationship.','sharedOff':'Private to you.',
      'professionalComments':'Professional comments','addComment':'Add professional comment','comment':'Comment',
      'commentImmutable':'Your comment is append-only and never edits the patient’s original entry.',
      'sharedReadOnly':'Patient-reported entry. Original content is read-only for providers.',
      'consentHint':'The patient must share the entry and grant HEALTH_PROFILE_READ consent to this provider.',
      'empty':'No food diary entries yet.','providerEmpty':'No shared food diary entries are available for this patient.',
      'save':'Save','cancel':'Cancel','refresh':'Refresh','descriptionRequired':'Describe the meal before saving.','commentRequired':'Enter a comment before saving.',
      'BREAKFAST':'Breakfast','LUNCH':'Lunch','DINNER':'Dinner','SNACK':'Snack','OTHER':'Other'
    },
    CarePointLocale.ar: {
      'patientTitle':'اليوميات الغذائية','providerTitle':'اليوميات الغذائية المشتركة','add':'إضافة وجبة','mealType':'نوع الوجبة',
      'description':'ماذا أكلت أو شربت؟','notes':'ملاحظات اختيارية','shareNow':'مشاركة مع فريق الرعاية',
      'shareHint':'مشاركة الإدخال لا تمنح الوصول وحدها؛ يحتاج مقدم الخدمة أيضاً إلى موافقة نشطة.',
      'shared':'إدخال مشترك','sharedOn':'مرئي فقط لمقدمي الخدمة المصرح لهم مع علاقة رعاية حالية.','sharedOff':'خاص بك.',
      'professionalComments':'تعليقات مهنية','addComment':'إضافة تعليق مهني','comment':'التعليق',
      'commentImmutable':'التعليق إضافي فقط ولا يغيّر إدخال المريض الأصلي.',
      'sharedReadOnly':'إدخال أبلغ عنه المريض. المحتوى الأصلي للقراءة فقط لدى مقدم الخدمة.',
      'consentHint':'يجب أن يشارك المريض الإدخال ويمنح موافقة HEALTH_PROFILE_READ لهذا المقدم.',
      'empty':'لا توجد إدخالات غذائية بعد.','providerEmpty':'لا توجد إدخالات غذائية مشتركة متاحة لهذا المريض.',
      'save':'حفظ','cancel':'إلغاء','refresh':'تحديث','descriptionRequired':'صف الوجبة قبل الحفظ.','commentRequired':'أدخل تعليقاً قبل الحفظ.',
      'BREAKFAST':'فطور','LUNCH':'غداء','DINNER':'عشاء','SNACK':'وجبة خفيفة','OTHER':'أخرى'
    },
    CarePointLocale.fr: {
      'patientTitle':'Journal alimentaire','providerTitle':'Journal alimentaire partagé','add':'Ajouter un repas','mealType':'Type de repas',
      'description':'Qu’avez-vous mangé ou bu ?','notes':'Notes facultatives','shareNow':'Partager avec l’équipe de soins',
      'shareHint':'Le partage seul ne donne pas accès; le prestataire cible doit aussi disposer d’un consentement actif.',
      'shared':'Entrée partagée','sharedOn':'Visible uniquement aux prestataires consentis avec une relation de soins actuelle.','sharedOff':'Privé pour vous.',
      'professionalComments':'Commentaires professionnels','addComment':'Ajouter un commentaire professionnel','comment':'Commentaire',
      'commentImmutable':'Le commentaire est append-only et ne modifie jamais l’entrée originale du patient.',
      'sharedReadOnly':'Entrée déclarée par le patient. Le contenu original est en lecture seule pour les prestataires.',
      'consentHint':'Le patient doit partager l’entrée et accorder le consentement HEALTH_PROFILE_READ à ce prestataire.',
      'empty':'Aucune entrée de journal alimentaire.','providerEmpty':'Aucune entrée partagée disponible pour ce patient.',
      'save':'Enregistrer','cancel':'Annuler','refresh':'Actualiser','descriptionRequired':'Décrivez le repas avant de l’enregistrer.','commentRequired':'Saisissez un commentaire avant de l’enregistrer.',
      'BREAKFAST':'Petit-déjeuner','LUNCH':'Déjeuner','DINNER':'Dîner','SNACK':'Collation','OTHER':'Autre'
    },
    CarePointLocale.es: {
      'patientTitle':'Diario alimentario','providerTitle':'Diario alimentario compartido','add':'Añadir comida','mealType':'Tipo de comida',
      'description':'¿Qué comiste o bebiste?','notes':'Notas opcionales','shareNow':'Compartir con el equipo asistencial',
      'shareHint':'Compartir una entrada no concede acceso por sí solo; el proveedor también necesita consentimiento activo.',
      'shared':'Entrada compartida','sharedOn':'Visible solo para proveedores consentidos con relación asistencial vigente.','sharedOff':'Privada para ti.',
      'professionalComments':'Comentarios profesionales','addComment':'Añadir comentario profesional','comment':'Comentario',
      'commentImmutable':'El comentario es append-only y nunca modifica la entrada original del paciente.',
      'sharedReadOnly':'Entrada declarada por el paciente. El contenido original es solo lectura para el proveedor.',
      'consentHint':'El paciente debe compartir la entrada y conceder HEALTH_PROFILE_READ a este proveedor.',
      'empty':'Todavía no hay entradas en el diario.','providerEmpty':'No hay entradas compartidas disponibles para este paciente.',
      'save':'Guardar','cancel':'Cancelar','refresh':'Actualizar','descriptionRequired':'Describe la comida antes de guardar.','commentRequired':'Escribe un comentario antes de guardar.',
      'BREAKFAST':'Desayuno','LUNCH':'Almuerzo','DINNER':'Cena','SNACK':'Tentempié','OTHER':'Otro'
    },
  };
  return values[locale]?[key] ?? values[CarePointLocale.en]![key] ?? key;
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return const {};
}
List<Map<String, dynamic>> _maps(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}
int _int(dynamic value, int fallback) => value is num ? value.toInt() : int.tryParse(value?.toString() ?? '') ?? fallback;
String _dateTime(dynamic raw) {
  final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (value == null) return '—';
  String two(int v) => v.toString().padLeft(2, '0');
  return '${two(value.day)}/${two(value.month)}/${value.year} ${two(value.hour)}:${two(value.minute)}';
}
