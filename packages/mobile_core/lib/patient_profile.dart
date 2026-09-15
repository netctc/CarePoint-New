import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class PatientProfilePage extends StatefulWidget {
  const PatientProfilePage({super.key, required this.session, required this.locale});

  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientProfilePage> createState() => _PatientProfilePageState();
}

class _PatientProfilePageState extends State<PatientProfilePage> {
  final firstName = TextEditingController();
  final lastName = TextEditingController();
  final phone = TextEditingController();
  bool loading = true;
  bool saving = false;
  bool stale = false;
  bool saved = false;
  String? expectedUpdatedAt;
  String? error;

  String t(String key) => patientProfileText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    if (widget.session.account['role'] == 'PATIENT') {
      load();
    } else {
      loading = false;
      error = t('denied');
    }
  }

  @override
  void dispose() {
    firstName.dispose();
    lastName.dispose();
    phone.dispose();
    super.dispose();
  }

  Future<void> load() async {
    if (widget.session.account['role'] != 'PATIENT') return;
    setState(() {
      loading = true;
      stale = false;
      error = null;
    });
    try {
      final value = await widget.session.api.patientProfile().timeout(const Duration(seconds: 30));
      if (!mounted) return;
      firstName.text = value['firstName']?.toString() ?? '';
      lastName.text = value['lastName']?.toString() ?? '';
      phone.text = value['phone']?.toString() ?? '';
      setState(() {
        expectedUpdatedAt = value['updatedAt']?.toString();
        saved = false;
      });
    } catch (_) {
      if (mounted) setState(() => error = t('loadFailed'));
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  String? validate() {
    final first = firstName.text.trim();
    final last = lastName.text.trim();
    final phoneValue = phone.text.trim();
    if (first.isEmpty || last.isEmpty) return t('nameRequired');
    if (first.length > 100 || last.length > 100) return t('nameLong');
    if (phoneValue.length > 40) return t('phoneLong');
    if (expectedUpdatedAt?.isNotEmpty != true) return t('reloadRequired');
    return null;
  }

  Future<void> save() async {
    if (saving || loading || stale || widget.session.account['role'] != 'PATIENT') return;
    final validation = validate();
    if (validation != null) {
      setState(() => error = validation);
      return;
    }
    setState(() {
      saving = true;
      saved = false;
      error = null;
    });
    try {
      final value = await widget.session.api.updatePatientProfile(
        firstName: firstName.text,
        lastName: lastName.text,
        phone: phone.text,
        expectedUpdatedAt: expectedUpdatedAt!,
      ).timeout(const Duration(seconds: 30));
      if (!mounted) return;
      firstName.text = value['firstName']?.toString() ?? '';
      lastName.text = value['lastName']?.toString() ?? '';
      phone.text = value['phone']?.toString() ?? '';
      setState(() {
        expectedUpdatedAt = value['updatedAt']?.toString();
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
        appBar: AppBar(title: Text(t('title'))),
        body: loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text(t('hint'), style: const TextStyle(color: Color(0xFF64748B))),
                  const SizedBox(height: 16),
                  TextField(
                    key: const ValueKey('profile-first-name'),
                    controller: firstName,
                    enabled: !saving && !stale,
                    maxLength: 100,
                    textInputAction: TextInputAction.next,
                    autofillHints: const [AutofillHints.givenName],
                    decoration: InputDecoration(labelText: t('firstName'), border: const OutlineInputBorder()),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    key: const ValueKey('profile-last-name'),
                    controller: lastName,
                    enabled: !saving && !stale,
                    maxLength: 100,
                    textInputAction: TextInputAction.next,
                    autofillHints: const [AutofillHints.familyName],
                    decoration: InputDecoration(labelText: t('lastName'), border: const OutlineInputBorder()),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    key: const ValueKey('profile-phone'),
                    controller: phone,
                    enabled: !saving && !stale,
                    maxLength: 40,
                    keyboardType: TextInputType.phone,
                    autofillHints: const [AutofillHints.telephoneNumber],
                    decoration: InputDecoration(labelText: t('phone'), helperText: t('phoneOptional'), border: const OutlineInputBorder()),
                  ),
                  if (error != null) ...[
                    const SizedBox(height: 8),
                    Semantics(liveRegion: true, child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
                  ],
                  if (saved) ...[
                    const SizedBox(height: 8),
                    Semantics(liveRegion: true, child: Text(t('saved'), style: const TextStyle(fontWeight: FontWeight.w700))),
                  ],
                  const SizedBox(height: 16),
                  Row(children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        key: const ValueKey('profile-reload'),
                        onPressed: saving ? null : load,
                        icon: const Icon(Icons.refresh),
                        label: Text(stale ? t('reloadLatest') : t('reload')),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton.icon(
                        key: const ValueKey('profile-save'),
                        onPressed: saving || stale || error == t('denied') ? null : save,
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

String patientProfileText(CarePointLocale locale, String key) =>
    _patientProfileText[locale.name]?[key] ?? _patientProfileText['en']?[key] ?? key;

const Map<String, Map<String, String>> _patientProfileText = {
  'en': {
    'title': 'Personal profile',
    'edit': 'Edit personal profile',
    'hint': 'Keep your CarePoint name and contact phone up to date. These changes do not change your sign-in email or identity verification.',
    'firstName': 'First name',
    'lastName': 'Last name',
    'phone': 'Phone',
    'phoneOptional': 'Optional contact number',
    'save': 'Save changes',
    'reload': 'Reload',
    'reloadLatest': 'Reload latest profile',
    'saved': 'Profile updated.',
    'conflict': 'This profile was changed from another session. Your changes were not saved.',
    'conflictHint': 'Reload the latest profile, review it, then make your changes again.',
    'loadFailed': 'Unable to load your profile. Try again.',
    'saveFailed': 'Unable to save your profile. Try again.',
    'invalid': 'Check the profile values and try again.',
    'nameRequired': 'First name and last name are required.',
    'nameLong': 'Names must contain at most 100 characters.',
    'phoneLong': 'Phone must contain at most 40 characters.',
    'reloadRequired': 'Reload your profile before saving.',
    'denied': 'Patient profile access is not available for this account.',
  },
  'ar': {
    'title': 'الملف الشخصي',
    'edit': 'تعديل الملف الشخصي',
    'hint': 'حافظ على تحديث الاسم ورقم الاتصال في CarePoint. لا تغيّر هذه التعديلات بريد تسجيل الدخول أو التحقق من الهوية.',
    'firstName': 'الاسم الأول',
    'lastName': 'اسم العائلة',
    'phone': 'الهاتف',
    'phoneOptional': 'رقم اتصال اختياري',
    'save': 'حفظ التغييرات',
    'reload': 'إعادة التحميل',
    'reloadLatest': 'تحميل أحدث ملف',
    'saved': 'تم تحديث الملف الشخصي.',
    'conflict': 'تم تعديل هذا الملف من جلسة أخرى. لم يتم حفظ تغييراتك.',
    'conflictHint': 'حمّل أحدث ملف وراجعه ثم أدخل تغييراتك مرة أخرى.',
    'loadFailed': 'تعذر تحميل ملفك الشخصي. حاول مرة أخرى.',
    'saveFailed': 'تعذر حفظ ملفك الشخصي. حاول مرة أخرى.',
    'invalid': 'تحقق من بيانات الملف وحاول مرة أخرى.',
    'nameRequired': 'الاسم الأول واسم العائلة مطلوبان.',
    'nameLong': 'يجب ألا يتجاوز الاسم 100 حرف.',
    'phoneLong': 'يجب ألا يتجاوز رقم الهاتف 40 حرفاً.',
    'reloadRequired': 'أعد تحميل ملفك قبل الحفظ.',
    'denied': 'الوصول إلى ملف المريض غير متاح لهذا الحساب.',
  },
  'fr': {
    'title': 'Profil personnel',
    'edit': 'Modifier le profil personnel',
    'hint': 'Maintenez à jour votre nom et votre téléphone dans CarePoint. Ces modifications ne changent pas votre e-mail de connexion ni la vérification d’identité.',
    'firstName': 'Prénom',
    'lastName': 'Nom',
    'phone': 'Téléphone',
    'phoneOptional': 'Numéro de contact facultatif',
    'save': 'Enregistrer',
    'reload': 'Recharger',
    'reloadLatest': 'Recharger le profil récent',
    'saved': 'Profil mis à jour.',
    'conflict': 'Ce profil a été modifié dans une autre session. Vos modifications n’ont pas été enregistrées.',
    'conflictHint': 'Rechargez le profil récent, vérifiez-le puis refaites vos modifications.',
    'loadFailed': 'Impossible de charger votre profil. Réessayez.',
    'saveFailed': 'Impossible d’enregistrer votre profil. Réessayez.',
    'invalid': 'Vérifiez les valeurs du profil et réessayez.',
    'nameRequired': 'Le prénom et le nom sont obligatoires.',
    'nameLong': 'Les noms doivent contenir au maximum 100 caractères.',
    'phoneLong': 'Le téléphone doit contenir au maximum 40 caractères.',
    'reloadRequired': 'Rechargez votre profil avant de l’enregistrer.',
    'denied': 'L’accès au profil patient n’est pas disponible pour ce compte.',
  },
  'es': {
    'title': 'Perfil personal',
    'edit': 'Editar perfil personal',
    'hint': 'Mantén actualizados tu nombre y teléfono de contacto en CarePoint. Estos cambios no modifican tu correo de acceso ni la verificación de identidad.',
    'firstName': 'Nombre',
    'lastName': 'Apellidos',
    'phone': 'Teléfono',
    'phoneOptional': 'Número de contacto opcional',
    'save': 'Guardar cambios',
    'reload': 'Recargar',
    'reloadLatest': 'Recargar perfil actualizado',
    'saved': 'Perfil actualizado.',
    'conflict': 'Este perfil se modificó desde otra sesión. Tus cambios no se han guardado.',
    'conflictHint': 'Recarga el perfil actualizado, revísalo y vuelve a introducir tus cambios.',
    'loadFailed': 'No se pudo cargar tu perfil. Inténtalo de nuevo.',
    'saveFailed': 'No se pudo guardar tu perfil. Inténtalo de nuevo.',
    'invalid': 'Revisa los datos del perfil e inténtalo de nuevo.',
    'nameRequired': 'El nombre y los apellidos son obligatorios.',
    'nameLong': 'Los nombres deben tener como máximo 100 caracteres.',
    'phoneLong': 'El teléfono debe tener como máximo 40 caracteres.',
    'reloadRequired': 'Recarga tu perfil antes de guardar.',
    'denied': 'El acceso al perfil de paciente no está disponible para esta cuenta.',
  },
};
