import 'carepoint_localization.dart';

const Map<CarePointLocale, Map<String, String>> _clinicalMessages = {
  CarePointLocale.en: {
    'healthRecord': 'Health record', 'clinicalChart': 'Clinical chart', 'patientHistory': 'Patient history', 'chiefComplaint': 'Chief complaint',
    'subjective': 'Subjective', 'objective': 'Objective', 'assessment': 'Assessment', 'plan': 'Treatment plan', 'vitals': 'Vital signs',
    'heartRate': 'Heart rate (bpm)', 'systolic': 'Systolic BP', 'diastolic': 'Diastolic BP', 'oxygen': 'Oxygen saturation %',
    'saveRevision': 'Save encrypted revision', 'finalize': 'Finalize encounter', 'finalizePrompt': 'Finalizing makes this clinical encounter immutable. Continue?',
    'finalized': 'Finalized', 'encrypted': 'Encrypted clinical record', 'noRecords': 'No clinical records are available yet.', 'revision': 'Revision',
    'accessBasis': 'Access basis', 'diagnoses': 'Diagnoses', 'provider': 'Provider', 'service': 'Service', 'close': 'Close', 'saved': 'Clinical revision saved.',
  },
  CarePointLocale.ar: {
    'healthRecord': 'السجل الصحي', 'clinicalChart': 'الملف السريري', 'patientHistory': 'التاريخ الصحي للمريض', 'chiefComplaint': 'الشكوى الرئيسية',
    'subjective': 'الأعراض والتاريخ', 'objective': 'الملاحظات الموضوعية', 'assessment': 'التقييم', 'plan': 'خطة العلاج', 'vitals': 'العلامات الحيوية',
    'heartRate': 'معدل القلب', 'systolic': 'الضغط الانقباضي', 'diastolic': 'الضغط الانبساطي', 'oxygen': 'تشبع الأكسجين %',
    'saveRevision': 'حفظ نسخة مشفرة', 'finalize': 'إنهاء السجل السريري', 'finalizePrompt': 'بعد الإنهاء يصبح هذا السجل غير قابل للتعديل. متابعة؟',
    'finalized': 'مغلق', 'encrypted': 'سجل سريري مشفر', 'noRecords': 'لا توجد سجلات سريرية بعد.', 'revision': 'النسخة',
    'accessBasis': 'أساس الصلاحية', 'diagnoses': 'التشخيصات', 'provider': 'مقدم الرعاية', 'service': 'الخدمة', 'close': 'إغلاق', 'saved': 'تم حفظ النسخة السريرية.',
  },
  CarePointLocale.fr: {
    'healthRecord': 'Dossier de santé', 'clinicalChart': 'Dossier clinique', 'patientHistory': 'Historique du patient', 'chiefComplaint': 'Motif principal',
    'subjective': 'Subjectif', 'objective': 'Objectif', 'assessment': 'Évaluation', 'plan': 'Plan de traitement', 'vitals': 'Signes vitaux',
    'heartRate': 'Fréquence cardiaque', 'systolic': 'TA systolique', 'diastolic': 'TA diastolique', 'oxygen': 'Saturation O2 %',
    'saveRevision': 'Enregistrer la version chiffrée', 'finalize': 'Finaliser la consultation', 'finalizePrompt': 'La finalisation rend ce dossier clinique immuable. Continuer ?',
    'finalized': 'Finalisé', 'encrypted': 'Dossier clinique chiffré', 'noRecords': 'Aucun dossier clinique disponible.', 'revision': 'Version',
    'accessBasis': 'Base d’accès', 'diagnoses': 'Diagnostics', 'provider': 'Prestataire', 'service': 'Service', 'close': 'Fermer', 'saved': 'Version clinique enregistrée.',
  },
  CarePointLocale.es: {
    'healthRecord': 'Historia clínica', 'clinicalChart': 'Ficha clínica', 'patientHistory': 'Historial del paciente', 'chiefComplaint': 'Motivo principal',
    'subjective': 'Subjetivo', 'objective': 'Objetivo', 'assessment': 'Evaluación', 'plan': 'Plan de tratamiento', 'vitals': 'Signos vitales',
    'heartRate': 'Frecuencia cardiaca', 'systolic': 'Tensión sistólica', 'diastolic': 'Tensión diastólica', 'oxygen': 'Saturación O2 %',
    'saveRevision': 'Guardar revisión cifrada', 'finalize': 'Finalizar encuentro', 'finalizePrompt': 'Al finalizar, este encuentro clínico quedará inmutable. ¿Continuar?',
    'finalized': 'Finalizado', 'encrypted': 'Registro clínico cifrado', 'noRecords': 'Todavía no hay registros clínicos.', 'revision': 'Revisión',
    'accessBasis': 'Base de acceso', 'diagnoses': 'Diagnósticos', 'provider': 'Proveedor', 'service': 'Servicio', 'close': 'Cerrar', 'saved': 'Revisión clínica guardada.',
  },
};

String clinicalText(CarePointLocale locale, String key) => _clinicalMessages[locale]?[key] ?? _clinicalMessages[CarePointLocale.en]![key] ?? key;
