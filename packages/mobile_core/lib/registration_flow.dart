import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class CarePointRegistrationResult {
  const CarePointRegistrationResult._({this.session, this.mfaChallenge});

  factory CarePointRegistrationResult.session(CarePointSession session) =>
      CarePointRegistrationResult._(session: session);

  factory CarePointRegistrationResult.mfa(CarePointMfaRequired challenge) =>
      CarePointRegistrationResult._(mfaChallenge: challenge);

  final CarePointSession? session;
  final CarePointMfaRequired? mfaChallenge;
}

Future<CarePointRegistrationResult?> showCarePointRegistrationFlow(
  BuildContext context, {
  required CarePointApi api,
  required CarePointLocale locale,
  required String expectedRole,
  required Color accent,
  bool dark = false,
}) =>
    showDialog<CarePointRegistrationResult>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _RegistrationFlowDialog(
        api: api,
        locale: locale,
        expectedRole: expectedRole,
        accent: accent,
        dark: dark,
      ),
    );

enum _Step { identity, otp, details }

class _RegistrationFlowDialog extends StatefulWidget {
  const _RegistrationFlowDialog({
    required this.api,
    required this.locale,
    required this.expectedRole,
    required this.accent,
    required this.dark,
  });

  final CarePointApi api;
  final CarePointLocale locale;
  final String expectedRole;
  final Color accent;
  final bool dark;

  @override
  State<_RegistrationFlowDialog> createState() => _RegistrationFlowDialogState();
}

class _RegistrationFlowDialogState extends State<_RegistrationFlowDialog> {
  final firstName = TextEditingController();
  final lastName = TextEditingController();
  final phone = TextEditingController();
  final otp = TextEditingController();
  final email = TextEditingController();
  final username = TextEditingController();
  final password = TextEditingController();
  final confirmPassword = TextEditingController();
  final dateOfBirth = TextEditingController();
  final reference = TextEditingController();

  _Step step = _Step.identity;
  bool busy = false;
  bool showPassword = false;
  String? error;
  String? challengeId;
  String? registrationToken;
  String? testOtp;
  String? deliveryMode;
  String? expiresAt;
  int attemptsRemaining = 3;
  String sex = 'PREFER_NOT_TO_SAY';
  String? specialtyId;
  String? providerCategoryId;
  List<Map<String, dynamic>> specialties = const [];
  List<Map<String, dynamic>> providerCategories = const [];

  @override
  void dispose() {
    firstName.dispose();
    lastName.dispose();
    phone.dispose();
    otp.dispose();
    email.dispose();
    username.dispose();
    password.dispose();
    confirmPassword.dispose();
    dateOfBirth.dispose();
    reference.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        backgroundColor: widget.dark ? const Color(0xFF172033) : null,
        title: Row(
          children: [
            Expanded(child: Text(_t('title'))),
            Text(
              step == _Step.identity ? '1/2' : step == _Step.otp ? 'OTP' : '2/2',
              style: Theme.of(context).textTheme.labelLarge,
            ),
          ],
        ),
        content: SizedBox(
          width: 560,
          child: SingleChildScrollView(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 180),
              child: switch (step) {
                _Step.identity => _identityStep(),
                _Step.otp => _otpStep(),
                _Step.details => _detailsStep(),
              },
            ),
          ),
        ),
        actions: _actions(),
      );

  Widget _identityStep() => Column(
        key: const ValueKey('identity'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(_t('identityHint')),
          const SizedBox(height: 16),
          _field(firstName, 'firstName'),
          const SizedBox(height: 10),
          _field(lastName, 'lastName'),
          const SizedBox(height: 10),
          _field(phone, 'phone', keyboardType: TextInputType.phone, hint: '+9665XXXXXXXX'),
          _error(),
        ],
      );

  Widget _otpStep() => Column(
        key: const ValueKey('otp'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(_t('otpHint')),
          const SizedBox(height: 10),
          _lockedSummary(),
          const SizedBox(height: 14),
          if (deliveryMode == 'display' && testOtp != null) ...[
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: widget.accent.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: widget.accent.withValues(alpha: 0.35)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.developer_mode_rounded),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(_t('testOtp'), style: const TextStyle(fontWeight: FontWeight.w800)),
                        SelectableText(
                          testOtp!,
                          style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, letterSpacing: 5),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => Clipboard.setData(ClipboardData(text: testOtp!)),
                    icon: const Icon(Icons.content_copy_rounded),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
          ],
          TextField(
            controller: otp,
            keyboardType: TextInputType.number,
            maxLength: 6,
            autofocus: true,
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(6),
            ],
            decoration: InputDecoration(
              labelText: _t('otpCode'),
              helperText: _t('otpAttempts').replaceAll('{n}', attemptsRemaining.toString()),
              border: const OutlineInputBorder(),
            ),
            onSubmitted: (_) => _verifyOtp(),
          ),
          if (expiresAt != null)
            Text(
              _t('expires') + ': ' + _formatExpiry(expiresAt!),
              style: Theme.of(context).textTheme.bodySmall,
            ),
          _error(),
        ],
      );

  Widget _detailsStep() => Column(
        key: const ValueKey('details'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(_t(widget.expectedRole == 'PATIENT' ? 'patientDetailsHint' : 'professionalDetailsHint')),
          const SizedBox(height: 14),
          _lockedSummary(),
          const SizedBox(height: 14),
          _field(email, 'emailOptional', keyboardType: TextInputType.emailAddress),
          const SizedBox(height: 10),
          if (widget.expectedRole == 'PATIENT') ...[
            TextField(
              controller: dateOfBirth,
              readOnly: true,
              onTap: _pickDateOfBirth,
              decoration: InputDecoration(
                labelText: _t('dateOfBirth'),
                suffixIcon: const Icon(Icons.calendar_month_rounded),
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: sex,
              decoration: InputDecoration(labelText: _t('sex'), border: const OutlineInputBorder()),
              items: const ['FEMALE', 'MALE', 'INTERSEX', 'OTHER', 'PREFER_NOT_TO_SAY']
                  .map((value) => DropdownMenuItem(value: value, child: Text(_t('sex.' + value))))
                  .toList(growable: false),
              onChanged: (value) => setState(() => sex = value ?? sex),
            ),
            const SizedBox(height: 10),
          ],
          if (widget.expectedRole == 'DOCTOR') ...[
            DropdownButtonFormField<String>(
              initialValue: specialtyId,
              decoration: InputDecoration(labelText: _t('specialty'), border: const OutlineInputBorder()),
              items: specialties
                  .map((item) => DropdownMenuItem<String>(
                        value: item['id']?.toString(),
                        child: Text(_localized(item['labels'], item['code']?.toString() ?? _t('specialty'))),
                      ))
                  .toList(growable: false),
              onChanged: (value) => setState(() => specialtyId = value),
            ),
            const SizedBox(height: 10),
          ],
          if (widget.expectedRole == 'OTHER_PROVIDER') ...[
            DropdownButtonFormField<String>(
              initialValue: providerCategoryId,
              decoration: InputDecoration(labelText: _t('providerCategory'), border: const OutlineInputBorder()),
              items: providerCategories
                  .map((item) => DropdownMenuItem<String>(
                        value: item['id']?.toString(),
                        child: Text(_localized(item['labels'], item['slug']?.toString() ?? _t('providerCategory'))),
                      ))
                  .toList(growable: false),
              onChanged: (value) => setState(() => providerCategoryId = value),
            ),
            const SizedBox(height: 10),
          ],
          _field(username, 'username'),
          const SizedBox(height: 10),
          TextField(
            controller: password,
            obscureText: !showPassword,
            autofillHints: const [AutofillHints.newPassword],
            decoration: InputDecoration(
              labelText: _t('password'),
              helperText: _t('passwordPolicy'),
              border: const OutlineInputBorder(),
              suffixIcon: IconButton(
                onPressed: () => setState(() => showPassword = !showPassword),
                icon: Icon(showPassword ? Icons.visibility_off_rounded : Icons.visibility_rounded),
              ),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: confirmPassword,
            obscureText: !showPassword,
            autofillHints: const [AutofillHints.newPassword],
            decoration: InputDecoration(labelText: _t('confirmPassword'), border: const OutlineInputBorder()),
          ),
          const SizedBox(height: 10),
          _field(reference, 'referenceOptional'),
          _error(),
        ],
      );

  Widget _lockedSummary() => Card(
        margin: EdgeInsets.zero,
        elevation: 0,
        color: widget.dark ? const Color(0xFF0F172A) : const Color(0xFFF1F5F9),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            children: [
              _lockedRow(_t('firstName'), firstName.text),
              _lockedRow(_t('lastName'), lastName.text),
              _lockedRow(_t('phone'), phone.text),
            ],
          ),
        ),
      );

  Widget _lockedRow(String label, String value) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 145, child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700))),
          Expanded(child: SelectableText(value)),
          const Icon(Icons.lock_outline_rounded, size: 17),
        ],
      );

  Widget _field(TextEditingController controller, String key, {TextInputType? keyboardType, String? hint}) =>
      TextField(
        controller: controller,
        keyboardType: keyboardType,
        decoration: InputDecoration(labelText: _t(key), hintText: hint, border: const OutlineInputBorder()),
      );

  Widget _error() => error == null
      ? const SizedBox.shrink()
      : Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Text(error!, style: const TextStyle(color: Color(0xFFDC2626), fontWeight: FontWeight.w700)),
        );

  List<Widget> _actions() => [
        TextButton(onPressed: busy ? null : () => Navigator.pop(context), child: Text(_t('cancel'))),
        if (step == _Step.otp)
          TextButton(
            onPressed: busy
                ? null
                : () => setState(() {
                      step = _Step.identity;
                      challengeId = null;
                      testOtp = null;
                      otp.clear();
                      error = null;
                    }),
            child: Text(_t('startOver')),
          ),
        FilledButton.icon(
          style: FilledButton.styleFrom(backgroundColor: widget.accent),
          onPressed: busy
              ? null
              : switch (step) {
                  _Step.identity => _startOtp,
                  _Step.otp => _verifyOtp,
                  _Step.details => _complete,
                },
          icon: busy
              ? const SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : Icon(
                  step == _Step.identity
                      ? Icons.sms_outlined
                      : step == _Step.otp
                          ? Icons.verified_user_outlined
                          : Icons.person_add_alt_1_rounded,
                ),
          label: Text(_t(step == _Step.identity ? 'sendOtp' : step == _Step.otp ? 'verifyOtp' : 'completeRegistration')),
        ),
      ];

  Future<void> _startOtp() async {
    if (firstName.text.trim().isEmpty || lastName.text.trim().isEmpty || phone.text.trim().isEmpty) {
      setState(() => error = _t('required'));
      return;
    }
    await _run(() async {
      final result = await widget.api.startRegistrationOtp(
        kind: widget.expectedRole,
        firstName: firstName.text,
        lastName: lastName.text,
        phone: phone.text,
      );
      challengeId = result['challengeId']?.toString();
      deliveryMode = result['deliveryMode']?.toString();
      testOtp = result['testOtp']?.toString();
      expiresAt = result['expiresAt']?.toString();
      attemptsRemaining = int.tryParse(result['attemptsRemaining']?.toString() ?? '') ?? 3;
      if (challengeId == null || challengeId!.isEmpty) {
        throw CarePointApiException('Registration OTP challenge was not created.');
      }
      setState(() => step = _Step.otp);
    });
  }

  Future<void> _verifyOtp() async {
    if (challengeId == null || otp.text.trim().length != 6) {
      setState(() => error = _t('otpInvalid'));
      return;
    }
    await _run(() async {
      final result = await widget.api.verifyRegistrationOtp(challengeId: challengeId!, code: otp.text);
      registrationToken = result['registrationToken']?.toString();
      firstName.text = result['firstName']?.toString() ?? firstName.text;
      lastName.text = result['lastName']?.toString() ?? lastName.text;
      phone.text = result['phone']?.toString() ?? phone.text;
      if (registrationToken == null || registrationToken!.isEmpty) {
        throw CarePointApiException('Registration verification token is missing.');
      }
      if (widget.expectedRole != 'PATIENT') {
        final options = await widget.api.registrationOptions();
        specialties = _list(options['specialties']);
        providerCategories = _list(options['providerCategories']);
        if (specialties.isNotEmpty) specialtyId = specialties.first['id']?.toString();
        if (providerCategories.isNotEmpty) providerCategoryId = providerCategories.first['id']?.toString();
      }
      setState(() => step = _Step.details);
    });
  }

  Future<void> _pickDateOfBirth() async {
    final now = DateTime.now();
    final selected = await showDatePicker(
      context: context,
      firstDate: DateTime(1900),
      lastDate: DateTime(now.year, now.month, now.day),
      initialDate: DateTime(now.year - 30, now.month, now.day),
    );
    if (selected != null) dateOfBirth.text = selected.toIso8601String().split('T').first;
  }

  Future<void> _complete() async {
    if (challengeId == null || registrationToken == null) {
      setState(() => error = _t('otpRequired'));
      return;
    }
    if (username.text.trim().isEmpty || password.text.isEmpty || confirmPassword.text.isEmpty) {
      setState(() => error = _t('required'));
      return;
    }
    if (password.text.length < 12 || password.text.length > 128) {
      setState(() => error = _t('passwordPolicy'));
      return;
    }
    if (password.text != confirmPassword.text) {
      setState(() => error = _t('passwordMismatch'));
      return;
    }
    if (!RegExp(r'^[a-zA-Z0-9._-]{3,40}$').hasMatch(username.text.trim())) {
      setState(() => error = _t('usernamePolicy'));
      return;
    }
    if (widget.expectedRole == 'PATIENT' && dateOfBirth.text.trim().isEmpty) {
      setState(() => error = _t('dateRequired'));
      return;
    }
    if (widget.expectedRole == 'DOCTOR' && specialtyId == null) {
      setState(() => error = _t('specialtyRequired'));
      return;
    }
    if (widget.expectedRole == 'OTHER_PROVIDER' && providerCategoryId == null) {
      setState(() => error = _t('categoryRequired'));
      return;
    }

    await _run(() async {
      try {
        final session = widget.expectedRole == 'PATIENT'
            ? await widget.api.registerPatient(
                challengeId: challengeId!,
                registrationToken: registrationToken!,
                email: email.text,
                username: username.text,
                password: password.text,
                dateOfBirth: dateOfBirth.text,
                sex: sex,
                reference: reference.text,
              )
            : await widget.api.registerProfessional(
                challengeId: challengeId!,
                registrationToken: registrationToken!,
                kind: widget.expectedRole,
                email: email.text,
                username: username.text,
                password: password.text,
                specialtyId: specialtyId,
                providerCategoryId: providerCategoryId,
                reference: reference.text,
              );
        if (mounted) Navigator.pop(context, CarePointRegistrationResult.session(session));
      } on CarePointMfaRequired catch (value) {
        if (mounted) Navigator.pop(context, CarePointRegistrationResult.mfa(value));
      }
    });
  }

  Future<void> _run(Future<void> Function() action) async {
    if (mounted) setState(() { busy = true; error = null; });
    try {
      await action();
    } catch (value) {
      if (mounted) {
        final message = value.toString();
        final match = RegExp(r'(\d+) attempt\(s\) remaining').firstMatch(message);
        if (match != null) attemptsRemaining = int.tryParse(match.group(1) ?? '') ?? attemptsRemaining;
        setState(() => error = message);
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  String _localized(dynamic labels, String fallback) {
    final map = _map(labels);
    final value = map[widget.locale.name]?.toString();
    final english = map['en']?.toString();
    if (value?.trim().isNotEmpty == true) return value!;
    if (english?.trim().isNotEmpty == true) return english!;
    return fallback;
  }

  String _formatExpiry(String value) {
    final parsed = DateTime.tryParse(value)?.toLocal();
    if (parsed == null) return value;
    return parsed.hour.toString().padLeft(2, '0') + ':' + parsed.minute.toString().padLeft(2, '0');
  }

  String _t(String key) {
    final lang = widget.locale.name;
    return _copy[lang]?[key] ?? _copy['en']![key] ?? key;
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

const _copy = <String, Map<String, String>>{
  'en': {
    'title':'CarePoint registration','identityHint':'Enter your name and mobile phone. We verify the phone before creating any account.','otpHint':'Enter the 6-digit verification code. It has limited validity and a maximum of 3 attempts.','patientDetailsHint':'Phone verified. Complete your patient account. Name and phone are locked to the verified data.','professionalDetailsHint':'Phone verified. Complete the professional account. Professional access remains pending CarePoint approval.','firstName':'First name','lastName':'Last name','phone':'Mobile phone','testOtp':'TEST OTP — visible only in display mode','otpCode':'6-digit OTP','otpAttempts':'{n} attempt(s) remaining','expires':'Expires','emailOptional':'Email (optional)','dateOfBirth':'Date of birth','sex':'Sex','sex.FEMALE':'Female','sex.MALE':'Male','sex.INTERSEX':'Intersex','sex.OTHER':'Other','sex.PREFER_NOT_TO_SAY':'Prefer not to say','specialty':'Medical specialty','providerCategory':'Provider type','username':'Username','password':'Password','confirmPassword':'Confirm password','referenceOptional':'Reference (optional)','passwordPolicy':'Use 12–128 characters.','usernamePolicy':'Username: 3–40 letters, numbers, dots, underscores or hyphens.','passwordMismatch':'Passwords do not match.','required':'Complete all required fields.','dateRequired':'Select the date of birth.','specialtyRequired':'Select a medical specialty.','categoryRequired':'Select a provider type.','otpInvalid':'Enter the complete 6-digit OTP.','otpRequired':'Phone verification is required.','sendOtp':'Send verification code','verifyOtp':'Verify code','completeRegistration':'Create account','startOver':'Start again','cancel':'Cancel',
  },
  'es': {
    'title':'Registro CarePoint','identityHint':'Introduce nombre, apellidos y teléfono móvil. El teléfono se verifica antes de crear cualquier cuenta.','otpHint':'Introduce el código de 6 dígitos. Tiene validez limitada y un máximo de 3 intentos.','patientDetailsHint':'Teléfono verificado. Completa la cuenta de paciente. Nombre y teléfono quedan bloqueados con los datos verificados.','professionalDetailsHint':'Teléfono verificado. Completa la cuenta profesional. El acceso profesional quedará pendiente de aprobación por CarePoint.','firstName':'Nombre','lastName':'Apellidos','phone':'Teléfono móvil','testOtp':'OTP DE PRUEBA — visible sólo en modo display','otpCode':'OTP de 6 dígitos','otpAttempts':'Quedan {n} intento(s)','expires':'Caduca','emailOptional':'Correo electrónico (opcional)','dateOfBirth':'Fecha de nacimiento','sex':'Sexo','sex.FEMALE':'Femenino','sex.MALE':'Masculino','sex.INTERSEX':'Intersexual','sex.OTHER':'Otro','sex.PREFER_NOT_TO_SAY':'Prefiero no indicarlo','specialty':'Especialidad médica','providerCategory':'Tipo de proveedor','username':'Nombre de usuario','password':'Contraseña','confirmPassword':'Confirmar contraseña','referenceOptional':'Referencia (opcional)','passwordPolicy':'Usa entre 12 y 128 caracteres.','usernamePolicy':'Usuario: 3–40 letras, números, puntos, guiones bajos o guiones.','passwordMismatch':'Las contraseñas no coinciden.','required':'Completa todos los campos obligatorios.','dateRequired':'Selecciona la fecha de nacimiento.','specialtyRequired':'Selecciona una especialidad médica.','categoryRequired':'Selecciona un tipo de proveedor.','otpInvalid':'Introduce el OTP completo de 6 dígitos.','otpRequired':'La verificación del teléfono es obligatoria.','sendOtp':'Enviar código','verifyOtp':'Verificar código','completeRegistration':'Crear cuenta','startOver':'Empezar de nuevo','cancel':'Cancelar',
  },
  'fr': {
    'title':'Inscription CarePoint','identityHint':'Saisissez votre prénom, nom et téléphone mobile. Le téléphone est vérifié avant la création du compte.','otpHint':'Saisissez le code à 6 chiffres. Sa validité est limitée et il autorise au maximum 3 tentatives.','patientDetailsHint':'Téléphone vérifié. Complétez le compte patient. Le nom et le téléphone sont verrouillés sur les données vérifiées.','professionalDetailsHint':'Téléphone vérifié. Complétez le compte professionnel. L’accès reste soumis à l’approbation CarePoint.','firstName':'Prénom','lastName':'Nom','phone':'Téléphone mobile','testOtp':'OTP DE TEST — visible uniquement en mode display','otpCode':'OTP à 6 chiffres','otpAttempts':'{n} tentative(s) restante(s)','expires':'Expire','emailOptional':'E-mail (optionnel)','dateOfBirth':'Date de naissance','sex':'Sexe','sex.FEMALE':'Femme','sex.MALE':'Homme','sex.INTERSEX':'Intersexe','sex.OTHER':'Autre','sex.PREFER_NOT_TO_SAY':'Préfère ne pas répondre','specialty':'Spécialité médicale','providerCategory':'Type de prestataire','username':'Nom d’utilisateur','password':'Mot de passe','confirmPassword':'Confirmer le mot de passe','referenceOptional':'Référence (optionnelle)','passwordPolicy':'Utilisez 12 à 128 caractères.','usernamePolicy':'Nom d’utilisateur : 3–40 lettres, chiffres, points, tirets bas ou tirets.','passwordMismatch':'Les mots de passe ne correspondent pas.','required':'Complétez tous les champs obligatoires.','dateRequired':'Sélectionnez la date de naissance.','specialtyRequired':'Sélectionnez une spécialité médicale.','categoryRequired':'Sélectionnez un type de prestataire.','otpInvalid':'Saisissez l’OTP complet à 6 chiffres.','otpRequired':'La vérification du téléphone est obligatoire.','sendOtp':'Envoyer le code','verifyOtp':'Vérifier le code','completeRegistration':'Créer le compte','startOver':'Recommencer','cancel':'Annuler',
  },
  'ar': {
    'title':'تسجيل CarePoint','identityHint':'أدخل الاسم واسم العائلة ورقم الهاتف المحمول. يتم التحقق من الهاتف قبل إنشاء أي حساب.','otpHint':'أدخل رمز التحقق المكوّن من 6 أرقام. صلاحيته محدودة ويسمح بحد أقصى 3 محاولات.','patientDetailsHint':'تم التحقق من الهاتف. أكمل حساب المريض. الاسم والهاتف مقفلان على البيانات التي تم التحقق منها.','professionalDetailsHint':'تم التحقق من الهاتف. أكمل الحساب المهني. يظل الوصول المهني بانتظار موافقة CarePoint.','firstName':'الاسم الأول','lastName':'اسم العائلة','phone':'الهاتف المحمول','testOtp':'رمز OTP للاختبار — يظهر فقط في وضع display','otpCode':'رمز OTP من 6 أرقام','otpAttempts':'المحاولات المتبقية: {n}','expires':'ينتهي','emailOptional':'البريد الإلكتروني (اختياري)','dateOfBirth':'تاريخ الميلاد','sex':'الجنس','sex.FEMALE':'أنثى','sex.MALE':'ذكر','sex.INTERSEX':'ثنائي الجنس','sex.OTHER':'آخر','sex.PREFER_NOT_TO_SAY':'أفضل عدم الإفصاح','specialty':'التخصص الطبي','providerCategory':'نوع مقدم الخدمة','username':'اسم المستخدم','password':'كلمة المرور','confirmPassword':'تأكيد كلمة المرور','referenceOptional':'مرجع (اختياري)','passwordPolicy':'استخدم من 12 إلى 128 حرفاً.','usernamePolicy':'اسم المستخدم: 3–40 حرفاً أو رقماً أو نقطة أو شرطة سفلية أو شرطة.','passwordMismatch':'كلمتا المرور غير متطابقتين.','required':'أكمل جميع الحقول المطلوبة.','dateRequired':'اختر تاريخ الميلاد.','specialtyRequired':'اختر التخصص الطبي.','categoryRequired':'اختر نوع مقدم الخدمة.','otpInvalid':'أدخل رمز OTP الكامل المكوّن من 6 أرقام.','otpRequired':'التحقق من الهاتف مطلوب.','sendOtp':'إرسال الرمز','verifyOtp':'التحقق من الرمز','completeRegistration':'إنشاء الحساب','startOver':'البدء من جديد','cancel':'إلغاء',
  },
};
