import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class CarePointRegistrationData {
  const CarePointRegistrationData({
    required this.email,
    required this.username,
    required this.password,
    required this.firstName,
    required this.lastName,
    required this.phone,
    this.dateOfBirth,
    this.sex,
    this.specialtyId,
    this.providerCategoryId,
  });

  final String email;
  final String username;
  final String password;
  final String firstName;
  final String lastName;
  final String phone;
  final String? dateOfBirth;
  final String? sex;
  final String? specialtyId;
  final String? providerCategoryId;
}

Future<CarePointRegistrationData?> showCarePointRegistrationDialog(
  BuildContext context, {
  required CarePointApi api,
  required CarePointLocale locale,
  required String expectedRole,
  required Color accent,
  bool dark = false,
}) async {
  final options = expectedRole == 'PATIENT'
      ? <String, dynamic>{}
      : await api.registrationOptions();
  if (!context.mounted) return null;
  return showDialog<CarePointRegistrationData>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _RegistrationDialog(
      locale: locale,
      expectedRole: expectedRole,
      accent: accent,
      dark: dark,
      options: options,
    ),
  );
}

class _RegistrationDialog extends StatefulWidget {
  const _RegistrationDialog({
    required this.locale,
    required this.expectedRole,
    required this.accent,
    required this.dark,
    required this.options,
  });

  final CarePointLocale locale;
  final String expectedRole;
  final Color accent;
  final bool dark;
  final Map<String, dynamic> options;

  @override
  State<_RegistrationDialog> createState() => _RegistrationDialogState();
}

class _RegistrationDialogState extends State<_RegistrationDialog> {
  final firstName = TextEditingController();
  final lastName = TextEditingController();
  final phone = TextEditingController();
  final email = TextEditingController();
  final username = TextEditingController();
  final password = TextEditingController();
  final confirmPassword = TextEditingController();
  final dateOfBirth = TextEditingController();
  String sex = 'PREFER_NOT_TO_SAY';
  String? specialtyId;
  String? providerCategoryId;
  String? error;
  bool showPassword = false;

  List<Map<String, dynamic>> get specialties =>
      _list(widget.options['specialties']);
  List<Map<String, dynamic>> get categories =>
      _list(widget.options['providerCategories']);

  @override
  void initState() {
    super.initState();
    if (specialties.isNotEmpty) specialtyId = specialties.first['id']?.toString();
    if (categories.isNotEmpty) providerCategoryId = categories.first['id']?.toString();
  }

  @override
  void dispose() {
    firstName.dispose();
    lastName.dispose();
    phone.dispose();
    email.dispose();
    username.dispose();
    password.dispose();
    confirmPassword.dispose();
    dateOfBirth.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        backgroundColor: widget.dark ? const Color(0xFF172033) : null,
        title: Text(_t('title')),
        content: SizedBox(
          width: 520,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(_t(widget.expectedRole == 'PATIENT'
                    ? 'patientHint'
                    : 'professionalHint')),
                const SizedBox(height: 16),
                Row(children: [
                  Expanded(child: _text(firstName, 'firstName')),
                  const SizedBox(width: 10),
                  Expanded(child: _text(lastName, 'lastName')),
                ]),
                const SizedBox(height: 10),
                _text(phone, 'phone', keyboardType: TextInputType.phone),
                const SizedBox(height: 10),
                _text(email, 'email', keyboardType: TextInputType.emailAddress),
                const SizedBox(height: 10),
                _text(username, 'username'),
                if (widget.expectedRole == 'PATIENT') ...[
                  const SizedBox(height: 10),
                  _text(
                    dateOfBirth,
                    'dateOfBirth',
                    keyboardType: TextInputType.datetime,
                    hintText: 'YYYY-MM-DD',
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    initialValue: sex,
                    decoration: InputDecoration(
                      labelText: _t('sex'),
                      border: const OutlineInputBorder(),
                    ),
                    items: const [
                      'FEMALE',
                      'MALE',
                      'INTERSEX',
                      'OTHER',
                      'PREFER_NOT_TO_SAY',
                    ]
                        .map((value) => DropdownMenuItem(
                              value: value,
                              child: Text(_t('sex.$value')),
                            ))
                        .toList(growable: false),
                    onChanged: (value) =>
                        setState(() => sex = value ?? sex),
                  ),
                ],
                if (widget.expectedRole == 'DOCTOR') ...[
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    initialValue: specialtyId,
                    decoration: InputDecoration(
                      labelText: _t('specialty'),
                      border: const OutlineInputBorder(),
                    ),
                    items: specialties
                        .map((item) => DropdownMenuItem<String>(
                              value: item['id']?.toString(),
                              child: Text(_localized(
                                item['labels'],
                                item['code']?.toString() ?? _t('specialty'),
                              )),
                            ))
                        .toList(growable: false),
                    onChanged: (value) =>
                        setState(() => specialtyId = value),
                  ),
                ],
                if (widget.expectedRole == 'OTHER_PROVIDER') ...[
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    initialValue: providerCategoryId,
                    decoration: InputDecoration(
                      labelText: _t('providerCategory'),
                      border: const OutlineInputBorder(),
                    ),
                    items: categories
                        .map((item) => DropdownMenuItem<String>(
                              value: item['id']?.toString(),
                              child: Text(_localized(
                                item['labels'],
                                item['slug']?.toString() ??
                                    _t('providerCategory'),
                              )),
                            ))
                        .toList(growable: false),
                    onChanged: (value) =>
                        setState(() => providerCategoryId = value),
                  ),
                ],
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
                      onPressed: () =>
                          setState(() => showPassword = !showPassword),
                      icon: Icon(showPassword
                          ? Icons.visibility_off
                          : Icons.visibility),
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: confirmPassword,
                  obscureText: !showPassword,
                  autofillHints: const [AutofillHints.newPassword],
                  decoration: InputDecoration(
                    labelText: _t('confirmPassword'),
                    border: const OutlineInputBorder(),
                  ),
                ),
                if (error != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    error!,
                    style: const TextStyle(
                      color: Color(0xFFDC2626),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(_t('cancel')),
          ),
          FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: widget.accent),
            onPressed: _submit,
            icon: const Icon(Icons.person_add_alt_1_rounded),
            label: Text(_t('register')),
          ),
        ],
      );

  Widget _text(
    TextEditingController controller,
    String key, {
    TextInputType? keyboardType,
    String? hintText,
  }) =>
      TextField(
        controller: controller,
        keyboardType: keyboardType,
        decoration: InputDecoration(
          labelText: _t(key),
          hintText: hintText,
          border: const OutlineInputBorder(),
        ),
      );

  void _submit() {
    final required = [
      firstName.text,
      lastName.text,
      phone.text,
      email.text,
      username.text,
      password.text,
      confirmPassword.text,
    ];
    if (required.any((value) => value.trim().isEmpty)) {
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
    if (!RegExp(r'^[a-zA-Z0-9._-]{3,40}$')
        .hasMatch(username.text.trim())) {
      setState(() => error = _t('usernamePolicy'));
      return;
    }
    if (widget.expectedRole == 'PATIENT') {
      if (!RegExp(r'^\d{4}-\d{2}-\d{2}$')
          .hasMatch(dateOfBirth.text.trim())) {
        setState(() => error = _t('datePolicy'));
        return;
      }
    }
    if (widget.expectedRole == 'DOCTOR' && specialtyId == null) {
      setState(() => error = _t('specialtyRequired'));
      return;
    }
    if (widget.expectedRole == 'OTHER_PROVIDER' &&
        providerCategoryId == null) {
      setState(() => error = _t('categoryRequired'));
      return;
    }

    Navigator.pop(
      context,
      CarePointRegistrationData(
        email: email.text.trim(),
        username: username.text.trim(),
        password: password.text,
        firstName: firstName.text.trim(),
        lastName: lastName.text.trim(),
        phone: phone.text.trim(),
        dateOfBirth: widget.expectedRole == 'PATIENT'
            ? dateOfBirth.text.trim()
            : null,
        sex: widget.expectedRole == 'PATIENT' ? sex : null,
        specialtyId:
            widget.expectedRole == 'DOCTOR' ? specialtyId : null,
        providerCategoryId: widget.expectedRole == 'OTHER_PROVIDER'
            ? providerCategoryId
            : null,
      ),
    );
  }

  String _localized(dynamic labels, String fallback) {
    final map = _map(labels);
    final value = map[widget.locale.name]?.toString();
    final english = map['en']?.toString();
    if (value?.trim().isNotEmpty == true) return value!;
    if (english?.trim().isNotEmpty == true) return english!;
    return fallback;
  }

  String _t(String key) {
    final language = widget.locale.name;
    return _copy[language]?[key] ?? _copy['en']![key] ?? key;
  }
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    return value.map((key, item) => MapEntry(key.toString(), item));
  }
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _list(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}

const _copy = <String, Map<String, String>>{
  'en': {
    'title': 'Create CarePoint account',
    'patientHint': 'Your patient account becomes active immediately after registration.',
    'professionalHint': 'Your account is created now, but professional access remains pending until CarePoint validates your membership and credentials.',
    'firstName': 'First name',
    'lastName': 'Last name',
    'phone': 'Contact phone',
    'email': 'Email',
    'username': 'Username',
    'dateOfBirth': 'Date of birth',
    'sex': 'Sex',
    'sex.FEMALE': 'Female',
    'sex.MALE': 'Male',
    'sex.INTERSEX': 'Intersex',
    'sex.OTHER': 'Other',
    'sex.PREFER_NOT_TO_SAY': 'Prefer not to say',
    'specialty': 'Medical specialty',
    'providerCategory': 'Provider category',
    'password': 'Password',
    'confirmPassword': 'Confirm password',
    'passwordPolicy': 'Use 12–128 characters.',
    'usernamePolicy': 'Username: 3–40 letters, numbers, dots, underscores or hyphens.',
    'datePolicy': 'Date of birth must use YYYY-MM-DD.',
    'passwordMismatch': 'Passwords do not match.',
    'required': 'Complete all required fields.',
    'specialtyRequired': 'Select a medical specialty.',
    'categoryRequired': 'Select a provider category.',
    'register': 'Register',
    'cancel': 'Cancel',
  },
  'es': {
    'title': 'Crear cuenta CarePoint',
    'patientHint': 'Tu cuenta de paciente quedará activa inmediatamente después del registro.',
    'professionalHint': 'La cuenta se crea ahora, pero el acceso profesional quedará pendiente hasta que CarePoint valide la membresía y las credenciales.',
    'firstName': 'Nombre',
    'lastName': 'Apellidos',
    'phone': 'Teléfono de contacto',
    'email': 'Correo electrónico',
    'username': 'Nombre de usuario',
    'dateOfBirth': 'Fecha de nacimiento',
    'sex': 'Sexo',
    'sex.FEMALE': 'Femenino',
    'sex.MALE': 'Masculino',
    'sex.INTERSEX': 'Intersexual',
    'sex.OTHER': 'Otro',
    'sex.PREFER_NOT_TO_SAY': 'Prefiero no indicarlo',
    'specialty': 'Especialidad médica',
    'providerCategory': 'Categoría de proveedor',
    'password': 'Contraseña',
    'confirmPassword': 'Confirmar contraseña',
    'passwordPolicy': 'Usa entre 12 y 128 caracteres.',
    'usernamePolicy': 'Usuario: 3–40 letras, números, puntos, guiones bajos o guiones.',
    'datePolicy': 'La fecha debe usar YYYY-MM-DD.',
    'passwordMismatch': 'Las contraseñas no coinciden.',
    'required': 'Completa todos los campos obligatorios.',
    'specialtyRequired': 'Selecciona una especialidad médica.',
    'categoryRequired': 'Selecciona una categoría de proveedor.',
    'register': 'Registrarse',
    'cancel': 'Cancelar',
  },
  'fr': {
    'title': 'Créer un compte CarePoint',
    'patientHint': 'Votre compte patient devient actif immédiatement après l’inscription.',
    'professionalHint': 'Le compte est créé maintenant, mais l’accès professionnel reste en attente de validation par CarePoint.',
    'firstName': 'Prénom',
    'lastName': 'Nom',
    'phone': 'Téléphone',
    'email': 'E-mail',
    'username': 'Nom d’utilisateur',
    'dateOfBirth': 'Date de naissance',
    'sex': 'Sexe',
    'sex.FEMALE': 'Femme',
    'sex.MALE': 'Homme',
    'sex.INTERSEX': 'Intersexe',
    'sex.OTHER': 'Autre',
    'sex.PREFER_NOT_TO_SAY': 'Préfère ne pas répondre',
    'specialty': 'Spécialité médicale',
    'providerCategory': 'Catégorie de prestataire',
    'password': 'Mot de passe',
    'confirmPassword': 'Confirmer le mot de passe',
    'passwordPolicy': 'Utilisez 12 à 128 caractères.',
    'usernamePolicy': 'Nom d’utilisateur : 3–40 lettres, chiffres, points, tirets bas ou tirets.',
    'datePolicy': 'La date doit utiliser YYYY-MM-DD.',
    'passwordMismatch': 'Les mots de passe ne correspondent pas.',
    'required': 'Complétez tous les champs obligatoires.',
    'specialtyRequired': 'Sélectionnez une spécialité médicale.',
    'categoryRequired': 'Sélectionnez une catégorie de prestataire.',
    'register': 'S’inscrire',
    'cancel': 'Annuler',
  },
  'ar': {
    'title': 'إنشاء حساب CarePoint',
    'patientHint': 'سيصبح حساب المريض نشطاً مباشرة بعد التسجيل.',
    'professionalHint': 'يتم إنشاء الحساب الآن، لكن الوصول المهني يبقى قيد المراجعة حتى تتحقق CarePoint من العضوية والاعتمادات.',
    'firstName': 'الاسم الأول',
    'lastName': 'اسم العائلة',
    'phone': 'هاتف التواصل',
    'email': 'البريد الإلكتروني',
    'username': 'اسم المستخدم',
    'dateOfBirth': 'تاريخ الميلاد',
    'sex': 'الجنس',
    'sex.FEMALE': 'أنثى',
    'sex.MALE': 'ذكر',
    'sex.INTERSEX': 'ثنائي الجنس',
    'sex.OTHER': 'آخر',
    'sex.PREFER_NOT_TO_SAY': 'أفضل عدم الإفصاح',
    'specialty': 'التخصص الطبي',
    'providerCategory': 'فئة مقدم الخدمة',
    'password': 'كلمة المرور',
    'confirmPassword': 'تأكيد كلمة المرور',
    'passwordPolicy': 'استخدم من 12 إلى 128 حرفاً.',
    'usernamePolicy': 'اسم المستخدم: 3–40 حرفاً أو رقماً أو نقطة أو شرطة سفلية أو شرطة.',
    'datePolicy': 'يجب أن يكون التاريخ بصيغة YYYY-MM-DD.',
    'passwordMismatch': 'كلمتا المرور غير متطابقتين.',
    'required': 'أكمل جميع الحقول المطلوبة.',
    'specialtyRequired': 'اختر التخصص الطبي.',
    'categoryRequired': 'اختر فئة مقدم الخدمة.',
    'register': 'تسجيل',
    'cancel': 'إلغاء',
  },
};
