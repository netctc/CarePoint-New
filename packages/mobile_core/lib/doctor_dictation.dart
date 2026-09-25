import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

Future<String?> showDoctorDictationDialog({
  required BuildContext context,
  required CarePointSession session,
  required CarePointLocale locale,
  required String appointmentId,
  required String targetField,
}) => showDialog<String>(
  context: context,
  barrierDismissible: false,
  builder: (_) => Directionality(
    textDirection: locale.textDirection,
    child: DoctorDictationDialog(
      session: session,
      locale: locale,
      appointmentId: appointmentId,
      targetField: targetField,
    ),
  ),
);

class DoctorDictationDialog extends StatefulWidget {
  const DoctorDictationDialog({
    super.key,
    required this.session,
    required this.locale,
    required this.appointmentId,
    required this.targetField,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final String appointmentId;
  final String targetField;

  @override
  State<DoctorDictationDialog> createState() => _DoctorDictationDialogState();
}

class _DoctorDictationDialogState extends State<DoctorDictationDialog> {
  final stt.SpeechToText speech = stt.SpeechToText();
  final TextEditingController transcript = TextEditingController();
  bool disclosureAccepted = false;
  bool listening = false;
  bool busy = false;
  String? securedJobId;
  String? error;

  String t(String key) => doctorDictationText(widget.locale, key);

  @override
  void dispose() {
    speech.stop();
    transcript.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    if (!disclosureAccepted || securedJobId != null || busy) return;
    setState(() => error = null);
    final available = await speech.initialize(
      onStatus: (status) {
        if (!mounted) return;
        setState(() => listening = status == 'listening');
      },
      onError: (value) {
        if (!mounted) return;
        setState(() {
          listening = false;
          error = value.errorMsg;
        });
      },
    );
    if (!available) {
      if (mounted) setState(() => error = t('unavailable'));
      return;
    }
    await speech.listen(
      listenOptions: stt.SpeechListenOptions(localeId: _speechLocale(widget.locale)),
      onResult: (result) {
        if (!mounted || securedJobId != null) return;
        transcript.value = transcript.value.copyWith(
          text: result.recognizedWords,
          selection: TextSelection.collapsed(offset: result.recognizedWords.length),
          composing: TextRange.empty,
        );
      },
    );
    if (mounted) setState(() => listening = true);
  }

  Future<void> _stop() async {
    await speech.stop();
    if (mounted) setState(() => listening = false);
  }

  Future<void> _secureDraft() async {
    await _stop();
    final text = transcript.text.trim();
    if (text.isEmpty || busy || securedJobId != null) {
      if (text.isEmpty && mounted) setState(() => error = t('empty'));
      return;
    }
    setState(() { busy = true; error = null; });
    try {
      final result = await widget.session.api.createDoctorDictationJob(
        appointmentId: widget.appointmentId,
        targetField: widget.targetField,
        transcript: text,
        locale: _speechLocale(widget.locale),
        idempotencyKey: 'dictation-${DateTime.now().microsecondsSinceEpoch}',
        deviceSpeechDisclosureAccepted: disclosureAccepted,
      );
      if (mounted) setState(() => securedJobId = result['id']?.toString());
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _confirmAndApply() async {
    final jobId = securedJobId;
    if (jobId == null || busy) return;
    setState(() { busy = true; error = null; });
    try {
      final result = await widget.session.api.confirmDoctorDictationJob(jobId);
      if (
        result['status'] != 'CONFIRMED' ||
        result['reviewedByHuman'] != true ||
        result['clinicalRecordWritten'] != false ||
        result['requiresSeparateClinicalSave'] != true
      ) {
        throw StateError(t('unsafeResponse'));
      }
      final confirmed = result['transcript']?.toString().trim() ?? '';
      if (confirmed.isEmpty) throw StateError(t('empty'));
      if (mounted) Navigator.pop(context, confirmed);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _discardAndClose() async {
    await _stop();
    final jobId = securedJobId;
    if (jobId != null) {
      try {
        await widget.session.api.discardDoctorDictationJob(jobId);
      } catch (_) {}
    }
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(t('title')),
    content: SizedBox(
      width: 560,
      child: SingleChildScrollView(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(t('safety'), style: const TextStyle(color: Color(0xFF475569))),
          const SizedBox(height: 10),
          CheckboxListTile(
            key: const ValueKey('doctor-dictation-device-disclosure'),
            contentPadding: EdgeInsets.zero,
            value: disclosureAccepted,
            onChanged: securedJobId == null && !busy
                ? (value) => setState(() => disclosureAccepted = value == true)
                : null,
            title: Text(t('disclosure')),
          ),
          const SizedBox(height: 8),
          TextField(
            key: const ValueKey('doctor-dictation-transcript'),
            controller: transcript,
            readOnly: securedJobId != null,
            minLines: 5,
            maxLines: 10,
            decoration: InputDecoration(
              labelText: t('draft'),
              helperText: securedJobId == null ? t('editHint') : t('securedHint'),
              border: const OutlineInputBorder(),
            ),
          ),
          if (error != null) Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ),
          const SizedBox(height: 12),
          if (securedJobId == null)
            Wrap(spacing: 8, runSpacing: 8, children: [
              FilledButton.tonalIcon(
                key: const ValueKey('doctor-dictation-listen'),
                onPressed: disclosureAccepted && !busy ? (listening ? _stop : _start) : null,
                icon: Icon(listening ? Icons.stop_circle_outlined : Icons.mic_none_outlined),
                label: Text(t(listening ? 'stop' : 'listen')),
              ),
              FilledButton.icon(
                key: const ValueKey('doctor-dictation-secure-draft'),
                onPressed: disclosureAccepted && !busy ? _secureDraft : null,
                icon: const Icon(Icons.lock_outline),
                label: Text(t('secureDraft')),
              ),
            ])
          else
            FilledButton.icon(
              key: const ValueKey('doctor-dictation-confirm-apply'),
              onPressed: busy ? null : _confirmAndApply,
              icon: const Icon(Icons.fact_check_outlined),
              label: Text(t('reviewedApply')),
            ),
        ]),
      ),
    ),
    actions: [
      TextButton(
        onPressed: busy ? null : _discardAndClose,
        child: Text(t('cancel')),
      ),
    ],
  );
}

String doctorDictationText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Clinical dictation draft','safety':'Voice recognition creates an unsigned draft only. CarePoint does not upload or store audio. Review every word before applying it. Applying does not save or sign the clinical record.','disclosure':'I understand the device/platform speech service may process microphone audio according to device settings.','draft':'Recognized text draft','editHint':'Edit the recognized text before securing it for review.','securedHint':'Encrypted draft secured. Confirm only after reviewing the exact text above.','listen':'Start dictation','stop':'Stop','secureDraft':'Secure review draft','reviewedApply':'I reviewed it — apply to field','cancel':'Discard / cancel','unavailable':'Speech recognition is unavailable or microphone permission was denied.','empty':'Dictation draft is empty.','unsafeResponse':'The dictation confirmation response did not preserve the safety contract.'
    },
    CarePointLocale.ar: {
      'title':'مسودة إملاء سريري','safety':'ينشئ التعرف الصوتي مسودة غير موقعة فقط. لا يرفع CarePoint الصوت ولا يخزنه. راجع كل كلمة قبل تطبيق النص. التطبيق لا يحفظ أو يوقّع السجل السريري.','disclosure':'أفهم أن خدمة التعرف الصوتي في الجهاز/النظام قد تعالج صوت الميكروفون وفق إعدادات الجهاز.','draft':'مسودة النص المتعرّف عليه','editHint':'عدّل النص قبل تأمينه للمراجعة.','securedHint':'تم تأمين المسودة مشفرة. أكد فقط بعد مراجعة النص أعلاه.','listen':'بدء الإملاء','stop':'إيقاف','secureDraft':'تأمين مسودة المراجعة','reviewedApply':'راجعت النص — تطبيقه على الحقل','cancel':'تجاهل / إلغاء','unavailable':'التعرف الصوتي غير متاح أو تم رفض إذن الميكروفون.','empty':'مسودة الإملاء فارغة.','unsafeResponse':'استجابة تأكيد الإملاء لم تحافظ على عقد السلامة.'
    },
    CarePointLocale.fr: {
      'title':'Brouillon de dictée clinique','safety':'La reconnaissance vocale crée uniquement un brouillon non signé. CarePoint ne téléverse ni ne stocke l’audio. Relisez chaque mot avant application. Appliquer ne sauvegarde ni ne signe le dossier clinique.','disclosure':'Je comprends que le service vocal de l’appareil/plateforme peut traiter le microphone selon les réglages de l’appareil.','draft':'Brouillon du texte reconnu','editHint':'Modifiez le texte reconnu avant de le sécuriser pour revue.','securedHint':'Brouillon chiffré sécurisé. Confirmez seulement après relecture du texte exact.','listen':'Démarrer la dictée','stop':'Arrêter','secureDraft':'Sécuriser le brouillon','reviewedApply':'Relu — appliquer au champ','cancel':'Supprimer / annuler','unavailable':'Reconnaissance vocale indisponible ou permission microphone refusée.','empty':'Le brouillon de dictée est vide.','unsafeResponse':'La réponse de confirmation ne respecte pas le contrat de sécurité.'
    },
    CarePointLocale.es: {
      'title':'Borrador de dictado clínico','safety':'El reconocimiento de voz crea sólo un borrador sin firmar. CarePoint no sube ni almacena audio. Revisa cada palabra antes de aplicarla. Aplicar no guarda ni firma la historia clínica.','disclosure':'Entiendo que el servicio de voz del dispositivo/plataforma puede procesar el micrófono según la configuración del dispositivo.','draft':'Borrador de texto reconocido','editHint':'Edita el texto reconocido antes de asegurarlo para revisión.','securedHint':'Borrador cifrado asegurado. Confirma sólo después de revisar exactamente el texto.','listen':'Iniciar dictado','stop':'Detener','secureDraft':'Asegurar borrador','reviewedApply':'Lo revisé — aplicar al campo','cancel':'Descartar / cancelar','unavailable':'El reconocimiento de voz no está disponible o se denegó el permiso de micrófono.','empty':'El borrador de dictado está vacío.','unsafeResponse':'La respuesta de confirmación no preservó el contrato de seguridad.'
    },
  };
  return values[locale]?[key] ?? values[CarePointLocale.en]![key] ?? key;
}

String _speechLocale(CarePointLocale locale) => switch (locale) {
  CarePointLocale.ar => 'ar-SA',
  CarePointLocale.fr => 'fr-FR',
  CarePointLocale.es => 'es-ES',
  _ => 'en-US',
};
