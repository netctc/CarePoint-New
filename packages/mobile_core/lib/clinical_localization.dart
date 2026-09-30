import 'carepoint_localization.dart';

const Map<CarePointLocale, Map<String, String>> _clinicalMessages = {
  CarePointLocale.en: {
    'healthRecord': 'Health record', 'clinicalChart': 'Clinical chart', 'patientHistory': 'Patient history', 'chiefComplaint': 'Chief complaint',
    'subjective': 'Subjective', 'objective': 'Objective', 'assessment': 'Assessment', 'plan': 'Treatment plan', 'vitals': 'Vital signs',
    'heartRate': 'Heart rate (bpm)', 'systolic': 'Systolic BP', 'diastolic': 'Diastolic BP', 'oxygen': 'Oxygen saturation %',
    'saveRevision': 'Save encrypted revision', 'finalize': 'Finalize encounter', 'signFinalize': 'Sign & finalize encounter', 'finalizePrompt': 'Finalizing makes this clinical encounter immutable. Continue?', 'signFinalizePrompt': 'Your MFA-assured clinical signature will bind to the current revision, then the encounter will become immutable. Continue?', 'signedFinalized': 'Clinical encounter signed and finalized.',
    'finalized': 'Finalized', 'encrypted': 'Encrypted clinical record', 'noRecords': 'No clinical records are available yet.', 'revision': 'Revision',
    'accessBasis': 'Access basis', 'diagnoses': 'Diagnoses', 'provider': 'Provider', 'service': 'Service', 'close': 'Close', 'saved': 'Clinical revision saved.', 'addendum': 'Add signed addendum', 'addenda': 'Signed addenda', 'addendumReason': 'Reason for addendum', 'addendumText': 'Addendum text', 'addendumSaved': 'Signed addendum added.', 'followUp': 'Recommend follow-up',
  },
  CarePointLocale.ar: {
    'healthRecord': 'السجل الصحي', 'clinicalChart': 'الملف السريري', 'patientHistory': 'التاريخ الصحي للمريض', 'chiefComplaint': 'الشكوى الرئيسية',
    'subjective': 'الأعراض والتاريخ', 'objective': 'الملاحظات الموضوعية', 'assessment': 'التقييم', 'plan': 'خطة العلاج', 'vitals': 'العلامات الحيوية',
    'heartRate': 'معدل القلب', 'systolic': 'الضغط الانقباضي', 'diastolic': 'الضغط الانبساطي', 'oxygen': 'تشبع الأكسجين %',
    'saveRevision': 'حفظ نسخة مشفرة', 'finalize': 'إنهاء السجل السريري', 'signFinalize': 'توقيع وإنهاء السجل', 'finalizePrompt': 'بعد الإنهاء يصبح هذا السجل غير قابل للتعديل. متابعة؟', 'signFinalizePrompt': 'سيتم ربط توقيعك السريري المؤكد عبر MFA بالنسخة الحالية ثم يصبح السجل غير قابل للتعديل. متابعة؟', 'signedFinalized': 'تم توقيع السجل السريري وإنهاؤه.',
    'finalized': 'مغلق', 'encrypted': 'سجل سريري مشفر', 'noRecords': 'لا توجد سجلات سريرية بعد.', 'revision': 'النسخة',
    'accessBasis': 'أساس الصلاحية', 'diagnoses': 'التشخيصات', 'provider': 'مقدم الرعاية', 'service': 'الخدمة', 'close': 'إغلاق', 'saved': 'تم حفظ النسخة السريرية.', 'addendum': 'إضافة ملحق موقع', 'addenda': 'الملاحق الموقعة', 'addendumReason': 'سبب الملحق', 'addendumText': 'نص الملحق', 'addendumSaved': 'تمت إضافة الملحق الموقع.', 'followUp': 'اقتراح متابعة',
  },
  CarePointLocale.fr: {
    'healthRecord': 'Dossier de santé', 'clinicalChart': 'Dossier clinique', 'patientHistory': 'Historique du patient', 'chiefComplaint': 'Motif principal',
    'subjective': 'Subjectif', 'objective': 'Objectif', 'assessment': 'Évaluation', 'plan': 'Plan de traitement', 'vitals': 'Signes vitaux',
    'heartRate': 'Fréquence cardiaque', 'systolic': 'TA systolique', 'diastolic': 'TA diastolique', 'oxygen': 'Saturation O2 %',
    'saveRevision': 'Enregistrer la version chiffrée', 'finalize': 'Finaliser la consultation', 'signFinalize': 'Signer et finaliser', 'finalizePrompt': 'La finalisation rend ce dossier clinique immuable. Continuer ?', 'signFinalizePrompt': 'Votre signature clinique avec assurance MFA sera liée à la version actuelle, puis la consultation deviendra immuable. Continuer ?', 'signedFinalized': 'Consultation clinique signée et finalisée.',
    'finalized': 'Finalisé', 'encrypted': 'Dossier clinique chiffré', 'noRecords': 'Aucun dossier clinique disponible.', 'revision': 'Version',
    'accessBasis': 'Base d’accès', 'diagnoses': 'Diagnostics', 'provider': 'Prestataire', 'service': 'Service', 'close': 'Fermer', 'saved': 'Version clinique enregistrée.', 'addendum': 'Ajouter un addendum signé', 'addenda': 'Addenda signés', 'addendumReason': 'Motif de l’addendum', 'addendumText': 'Texte de l’addendum', 'addendumSaved': 'Addendum signé ajouté.', 'followUp': 'Recommander un suivi',
  },
  CarePointLocale.es: {
    'healthRecord': 'Historia clínica', 'clinicalChart': 'Ficha clínica', 'patientHistory': 'Historial del paciente', 'chiefComplaint': 'Motivo principal',
    'subjective': 'Subjetivo', 'objective': 'Objetivo', 'assessment': 'Evaluación', 'plan': 'Plan de tratamiento', 'vitals': 'Signos vitales',
    'heartRate': 'Frecuencia cardiaca', 'systolic': 'Tensión sistólica', 'diastolic': 'Tensión diastólica', 'oxygen': 'Saturación O2 %',
    'saveRevision': 'Guardar revisión cifrada', 'finalize': 'Finalizar encuentro', 'signFinalize': 'Firmar y finalizar', 'finalizePrompt': 'Al finalizar, este encuentro clínico quedará inmutable. ¿Continuar?', 'signFinalizePrompt': 'Tu firma clínica con MFA quedará vinculada a la revisión actual y después el encuentro será inmutable. ¿Continuar?', 'signedFinalized': 'Encuentro clínico firmado y finalizado.',
    'finalized': 'Finalizado', 'encrypted': 'Registro clínico cifrado', 'noRecords': 'Todavía no hay registros clínicos.', 'revision': 'Revisión',
    'accessBasis': 'Base de acceso', 'diagnoses': 'Diagnósticos', 'provider': 'Proveedor', 'service': 'Servicio', 'close': 'Cerrar', 'saved': 'Revisión clínica guardada.', 'addendum': 'Añadir addendum firmado', 'addenda': 'Addenda firmados', 'addendumReason': 'Motivo del addendum', 'addendumText': 'Texto del addendum', 'addendumSaved': 'Addendum firmado añadido.', 'followUp': 'Recomendar seguimiento',
  },
};

String clinicalText(CarePointLocale locale, String key) => _clinicalMessages[locale]?[key] ?? _clinicalMessages[CarePointLocale.en]![key] ?? key;
