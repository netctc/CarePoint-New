import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

const List<String> patientAccessNeedCodes = [
  'WHEELCHAIR',
  'MOBILITY_ASSISTANCE',
  'STEP_FREE_ACCESS',
  'ACCESSIBLE_TRANSPORT',
  'HEARING_SUPPORT',
  'VISUAL_SUPPORT',
  'SIGN_LANGUAGE',
  'COMMUNICATION_SUPPORT',
  'CAREGIVER_SUPPORT',
  'HOME_VISIT_SUPPORT',
];

class PatientAccessNeedsPage extends StatefulWidget {
  const PatientAccessNeedsPage({super.key, required this.session, required this.locale});

  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientAccessNeedsPage> createState() => _PatientAccessNeedsPageState();
}

class _PatientAccessNeedsPageState extends State<PatientAccessNeedsPage> {
  final note = TextEditingController();
  final Set<String> selected = <String>{};
  bool loading = true;
  bool saving = false;
  bool saved = false;
  bool stale = false;
  int version = 0;
  String? error;

  String t(String key) => patientAccessNeedsText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    note.dispose();
    super.dispose();
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      stale = false;
      saved = false;
      error = null;
    });
    try {
      final response = await widget.session.api.patientAccessNeeds().timeout(const Duration(seconds: 30));
      final rawNeeds = response['needs'];
      final next = rawNeeds is List ? rawNeeds.map((item) => item.toString()).where(patientAccessNeedCodes.contains).toSet() : <String>{};
      if (!mounted) return;
      note.text = response['note']?.toString() ?? '';
      setState(() {
        selected
          ..clear()
          ..addAll(next);
        version = int.tryParse(response['version']?.toString() ?? '') ?? 0;
      });
    } catch (_) {
      if (mounted) setState(() => error = t('loadFailed'));
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> save() async {
    if (saving || loading || stale) return;
    final noteValue = note.text.trim();
    if (noteValue.length > 500) {
      setState(() => error = t('noteTooLong'));
      return;
    }
    setState(() {
      saving = true;
      saved = false;
      error = null;
    });
    try {
      final ordered = patientAccessNeedCodes.where(selected.contains).toList(growable: false);
      final response = await widget.session.api.updatePatientAccessNeeds(
        needs: ordered,
        expectedVersion: version,
        note: noteValue.isEmpty ? null : noteValue,
      ).timeout(const Duration(seconds: 30));
      if (!mounted) return;
      note.text = response['note']?.toString() ?? '';
      setState(() {
        version = int.tryParse(response['version']?.toString() ?? '') ?? version;
        saved = true;
      });
    } on CarePointApiException catch (value) {
      if (!mounted) return;
      if (value.statusCode == 409) {
        setState(() {
          stale = true;
          error = t('conflict');
        });
      } else if (value.statusCode == 400) {
        setState(() => error = t('invalid'));
      } else {
        setState(() => error = t('saveFailed'));
      }
    } catch (_) {
      if (mounted) setState(() => error = t('saveFailed'));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: widget.locale.textDirection,
      child: Scaffold(
        appBar: AppBar(
          title: Text(t('title')),
          actions: [IconButton(onPressed: saving ? null : load, icon: const Icon(Icons.refresh), tooltip: t('reload'))],
        ),
        body: loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(children: [
                            const Icon(Icons.accessible_forward_outlined),
                            const SizedBox(width: 10),
                            Expanded(child: Text(t('introTitle'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17))),
                          ]),
                          const SizedBox(height: 8),
                          Text(t('hint'), style: const TextStyle(color: Color(0xFF64748B))),
                          const SizedBox(height: 8),
                          Text(t('propagationHint'), style: const TextStyle(fontWeight: FontWeight.w600)),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  ...patientAccessNeedCodes.map((code) => Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: CheckboxListTile(
                          key: ValueKey('access-need-$code'),
                          value: selected.contains(code),
                          onChanged: saving || stale
                              ? null
                              : (value) => setState(() {
                                    saved = false;
                                    if (value == true) {
                                      selected.add(code);
                                    } else {
                                      selected.remove(code);
                                    }
                                  }),
                          title: Text(t('need.$code')),
                          controlAffinity: ListTileControlAffinity.leading,
                        ),
                      )),
                  const SizedBox(height: 12),
                  TextField(
                    key: const ValueKey('access-needs-note'),
                    controller: note,
                    enabled: !saving && !stale,
                    minLines: 2,
                    maxLines: 5,
                    maxLength: 500,
                    decoration: InputDecoration(
                      labelText: t('note'),
                      helperText: t('noteHint'),
                      border: const OutlineInputBorder(),
                      alignLabelWithHint: true,
                    ),
                  ),
                  if (error != null) ...[
                    const SizedBox(height: 8),
                    Semantics(liveRegion: true, child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
                  ],
                  if (saved) ...[
                    const SizedBox(height: 8),
                    Semantics(liveRegion: true, child: Text(t('saved'), style: const TextStyle(fontWeight: FontWeight.w800))),
                  ],
                  const SizedBox(height: 16),
                  Row(children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        key: const ValueKey('access-needs-reload'),
                        onPressed: saving ? null : load,
                        icon: const Icon(Icons.refresh),
                        label: Text(stale ? t('reloadLatest') : t('reload')),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton.icon(
                        key: const ValueKey('access-needs-save'),
                        onPressed: saving || stale ? null : save,
                        icon: saving
                            ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.save_outlined),
                        label: Text(t('save')),
                      ),
                    ),
                  ]),
                  if (stale) ...[
                    const SizedBox(height: 12),
                    Text(t('conflictHint'), style: const TextStyle(color: Color(0xFF64748B))),
                  ],
                ],
              ),
      ),
    );
  }
}

String patientAccessNeedsText(CarePointLocale locale, String key) =>
    _patientAccessNeedsText[locale.name]?[key] ?? _patientAccessNeedsText['en']?[key] ?? key;

const Map<String, Map<String, String>> _patientAccessNeedsText = {
  'en': {
    'title': 'Accessibility & support needs',
    'open': 'Accessibility & support needs',
    'introTitle': 'Tell CarePoint what support you need',
    'hint': 'Select only practical support requirements. These entries do not create or infer a diagnosis.',
    'propagationHint': 'Saved needs are captured when compatible appointments, home visits, and medical transport are created so the care team can prepare.',
    'note': 'Additional instructions',
    'noteHint': 'Optional. Avoid adding information that is not needed to arrange your care.',
    'save': 'Save needs',
    'reload': 'Reload',
    'reloadLatest': 'Reload latest',
    'saved': 'Accessibility and support needs updated.',
    'loadFailed': 'Unable to load your accessibility needs. Try again.',
    'saveFailed': 'Unable to save your accessibility needs. Try again.',
    'invalid': 'Check the selected needs and note, then try again.',
    'noteTooLong': 'Additional instructions must contain at most 500 characters.',
    'conflict': 'These needs were changed from another session. Your changes were not saved.',
    'conflictHint': 'Reload the latest version, review it, then make your changes again.',
    'need.WHEELCHAIR': 'Wheelchair access',
    'need.MOBILITY_ASSISTANCE': 'Mobility assistance',
    'need.STEP_FREE_ACCESS': 'Step-free access',
    'need.ACCESSIBLE_TRANSPORT': 'Accessible medical transport',
    'need.HEARING_SUPPORT': 'Hearing support',
    'need.VISUAL_SUPPORT': 'Visual accessibility support',
    'need.SIGN_LANGUAGE': 'Sign-language support',
    'need.COMMUNICATION_SUPPORT': 'Communication support',
    'need.CAREGIVER_SUPPORT': 'Caregiver / companion support',
    'need.HOME_VISIT_SUPPORT': 'Additional support for home visits',
  },
  'ar': {
    'title': 'احتياجات الوصول والدعم',
    'open': 'احتياجات الوصول والدعم',
    'introTitle': 'أخبر CarePoint بالدعم الذي تحتاجه',
    'hint': 'اختر متطلبات الدعم العملية فقط. هذه البيانات لا تنشئ تشخيصاً ولا تستنتجه.',
    'propagationHint': 'تُحفظ الاحتياجات مع المواعيد والزيارات المنزلية والنقل الطبي المتوافق عند إنشائها كي يتمكن فريق الرعاية من الاستعداد.',
    'note': 'تعليمات إضافية',
    'noteHint': 'اختياري. تجنب إضافة معلومات غير ضرورية لترتيب الرعاية.',
    'save': 'حفظ الاحتياجات',
    'reload': 'إعادة التحميل',
    'reloadLatest': 'تحميل أحدث نسخة',
    'saved': 'تم تحديث احتياجات الوصول والدعم.',
    'loadFailed': 'تعذر تحميل احتياجات الوصول. حاول مجدداً.',
    'saveFailed': 'تعذر حفظ احتياجات الوصول. حاول مجدداً.',
    'invalid': 'تحقق من الاحتياجات المحددة والملاحظة ثم حاول مجدداً.',
    'noteTooLong': 'يجب ألا تتجاوز التعليمات الإضافية 500 حرف.',
    'conflict': 'تم تعديل هذه الاحتياجات من جلسة أخرى. لم يتم حفظ تغييراتك.',
    'conflictHint': 'حمّل أحدث نسخة وراجعها ثم أدخل تغييراتك مرة أخرى.',
    'need.WHEELCHAIR': 'إمكانية الوصول بالكرسي المتحرك',
    'need.MOBILITY_ASSISTANCE': 'مساعدة في الحركة',
    'need.STEP_FREE_ACCESS': 'وصول دون درجات',
    'need.ACCESSIBLE_TRANSPORT': 'نقل طبي مهيأ',
    'need.HEARING_SUPPORT': 'دعم للسمع',
    'need.VISUAL_SUPPORT': 'دعم الوصول البصري',
    'need.SIGN_LANGUAGE': 'دعم لغة الإشارة',
    'need.COMMUNICATION_SUPPORT': 'دعم التواصل',
    'need.CAREGIVER_SUPPORT': 'دعم مرافق أو مقدم رعاية',
    'need.HOME_VISIT_SUPPORT': 'دعم إضافي للزيارات المنزلية',
  },
  'fr': {
    'title': 'Accessibilité et besoins d’assistance',
    'open': 'Accessibilité et besoins d’assistance',
    'introTitle': 'Indiquez à CarePoint l’assistance nécessaire',
    'hint': 'Sélectionnez uniquement les besoins pratiques. Ces informations ne créent ni ne déduisent de diagnostic.',
    'propagationHint': 'Les besoins enregistrés sont capturés lors de la création des rendez-vous, visites à domicile et transports médicaux compatibles afin que l’équipe puisse se préparer.',
    'note': 'Instructions supplémentaires',
    'noteHint': 'Facultatif. Évitez les informations qui ne sont pas nécessaires à l’organisation des soins.',
    'save': 'Enregistrer',
    'reload': 'Recharger',
    'reloadLatest': 'Recharger la dernière version',
    'saved': 'Besoins d’accessibilité et d’assistance mis à jour.',
    'loadFailed': 'Impossible de charger vos besoins d’accessibilité. Réessayez.',
    'saveFailed': 'Impossible d’enregistrer vos besoins d’accessibilité. Réessayez.',
    'invalid': 'Vérifiez les besoins sélectionnés et la note, puis réessayez.',
    'noteTooLong': 'Les instructions supplémentaires ne doivent pas dépasser 500 caractères.',
    'conflict': 'Ces besoins ont été modifiés depuis une autre session. Vos modifications n’ont pas été enregistrées.',
    'conflictHint': 'Rechargez la dernière version, vérifiez-la puis recommencez vos modifications.',
    'need.WHEELCHAIR': 'Accès en fauteuil roulant',
    'need.MOBILITY_ASSISTANCE': 'Aide à la mobilité',
    'need.STEP_FREE_ACCESS': 'Accès sans marche',
    'need.ACCESSIBLE_TRANSPORT': 'Transport médical accessible',
    'need.HEARING_SUPPORT': 'Assistance auditive',
    'need.VISUAL_SUPPORT': 'Assistance visuelle',
    'need.SIGN_LANGUAGE': 'Assistance en langue des signes',
    'need.COMMUNICATION_SUPPORT': 'Aide à la communication',
    'need.CAREGIVER_SUPPORT': 'Assistance d’un aidant / accompagnant',
    'need.HOME_VISIT_SUPPORT': 'Assistance supplémentaire pour les visites à domicile',
  },
  'es': {
    'title': 'Accesibilidad y necesidades de apoyo',
    'open': 'Accesibilidad y necesidades de apoyo',
    'introTitle': 'Indica a CarePoint qué apoyo necesitas',
    'hint': 'Selecciona únicamente requisitos prácticos de apoyo. Estos datos no crean ni infieren un diagnóstico.',
    'propagationHint': 'Las necesidades guardadas se capturan al crear citas, visitas a domicilio y transporte médico compatibles para que el equipo pueda prepararse.',
    'note': 'Instrucciones adicionales',
    'noteHint': 'Opcional. Evita añadir información que no sea necesaria para organizar tu atención.',
    'save': 'Guardar necesidades',
    'reload': 'Recargar',
    'reloadLatest': 'Recargar versión actual',
    'saved': 'Necesidades de accesibilidad y apoyo actualizadas.',
    'loadFailed': 'No se pudieron cargar tus necesidades de accesibilidad. Inténtalo de nuevo.',
    'saveFailed': 'No se pudieron guardar tus necesidades de accesibilidad. Inténtalo de nuevo.',
    'invalid': 'Revisa las necesidades seleccionadas y la nota e inténtalo de nuevo.',
    'noteTooLong': 'Las instrucciones adicionales deben tener como máximo 500 caracteres.',
    'conflict': 'Estas necesidades se modificaron desde otra sesión. Tus cambios no se han guardado.',
    'conflictHint': 'Recarga la versión actual, revísala y vuelve a introducir tus cambios.',
    'need.WHEELCHAIR': 'Acceso con silla de ruedas',
    'need.MOBILITY_ASSISTANCE': 'Asistencia de movilidad',
    'need.STEP_FREE_ACCESS': 'Acceso sin escalones',
    'need.ACCESSIBLE_TRANSPORT': 'Transporte médico accesible',
    'need.HEARING_SUPPORT': 'Apoyo auditivo',
    'need.VISUAL_SUPPORT': 'Apoyo de accesibilidad visual',
    'need.SIGN_LANGUAGE': 'Apoyo con lengua de signos',
    'need.COMMUNICATION_SUPPORT': 'Apoyo de comunicación',
    'need.CAREGIVER_SUPPORT': 'Apoyo de cuidador o acompañante',
    'need.HOME_VISIT_SUPPORT': 'Apoyo adicional para visitas a domicilio',
  },
};
