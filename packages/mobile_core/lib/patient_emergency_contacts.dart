import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class PatientEmergencyContactsPage extends StatefulWidget {
  const PatientEmergencyContactsPage({super.key, required this.session, required this.locale});

  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientEmergencyContactsPage> createState() => _PatientEmergencyContactsPageState();
}

class _PatientEmergencyContactsPageState extends State<PatientEmergencyContactsPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> contacts = const [];

  String t(String key) => emergencyContactText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final value = await widget.session.api.emergencyContacts().timeout(const Duration(seconds: 30));
      if (!mounted) return;
      setState(() => contacts = value);
    } catch (_) {
      if (mounted) setState(() => error = t('loadFailed'));
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> edit([Map<String, dynamic>? existing]) async {
    final changed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => Directionality(
        textDirection: widget.locale.textDirection,
        child: _EmergencyContactDialog(
          session: widget.session,
          locale: widget.locale,
          existing: existing,
        ),
      ),
    );
    if (changed == true) await load();
  }

  Future<void> revoke(Map<String, dynamic> contact) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(t('removeTitle')),
        content: Text(t('removeConfirm').replaceFirst('{name}', contact['displayName']?.toString() ?? '')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(t('remove'))),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.session.api.revokeEmergencyContact(contact['id'].toString()).timeout(const Duration(seconds: 30));
      await load();
    } catch (_) {
      if (mounted) setState(() => error = t('removeFailed'));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: widget.locale.textDirection,
      child: Scaffold(
        appBar: AppBar(
          title: Text(t('title')),
          actions: [IconButton(onPressed: loading ? null : load, icon: const Icon(Icons.refresh), tooltip: t('reload'))],
        ),
        floatingActionButton: FloatingActionButton.extended(
          key: const ValueKey('emergency-contact-add'),
          onPressed: contacts.length >= 10 ? null : () => edit(),
          icon: const Icon(Icons.person_add_alt_1_outlined),
          label: Text(t('add')),
        ),
        body: loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: load,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                  children: [
                    Text(t('hint'), style: const TextStyle(color: Color(0xFF64748B))),
                    const SizedBox(height: 12),
                    if (error != null)
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Semantics(liveRegion: true, child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
                        ),
                      ),
                    if (contacts.isEmpty)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 36),
                        child: Column(
                          children: [
                            const Icon(Icons.contact_emergency_outlined, size: 48),
                            const SizedBox(height: 12),
                            Text(t('empty'), textAlign: TextAlign.center),
                          ],
                        ),
                      )
                    else
                      ...contacts.map((contact) => Card(
                            key: ValueKey('emergency-contact-${contact['id']}'),
                            margin: const EdgeInsets.only(bottom: 10),
                            child: ListTile(
                              leading: CircleAvatar(child: Text('${contact['priority'] ?? ''}')),
                              title: Text(contact['displayName']?.toString() ?? ''),
                              subtitle: Text('${contact['relationship'] ?? ''}\n${contact['phone'] ?? ''}'),
                              isThreeLine: true,
                              trailing: PopupMenuButton<String>(
                                onSelected: (value) {
                                  if (value == 'edit') edit(contact);
                                  if (value == 'remove') revoke(contact);
                                },
                                itemBuilder: (_) => [
                                  PopupMenuItem(value: 'edit', child: Text(t('edit'))),
                                  PopupMenuItem(value: 'remove', child: Text(t('remove'))),
                                ],
                              ),
                            ),
                          )),
                    if (contacts.length >= 10)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(t('limitReached'), style: const TextStyle(color: Color(0xFF64748B))),
                      ),
                  ],
                ),
              ),
      ),
    );
  }
}

class _EmergencyContactDialog extends StatefulWidget {
  const _EmergencyContactDialog({required this.session, required this.locale, this.existing});

  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic>? existing;

  @override
  State<_EmergencyContactDialog> createState() => _EmergencyContactDialogState();
}

class _EmergencyContactDialogState extends State<_EmergencyContactDialog> {
  late final TextEditingController name;
  late final TextEditingController relationship;
  late final TextEditingController phone;
  late final TextEditingController priority;
  bool saving = false;
  String? error;

  String t(String key) => emergencyContactText(widget.locale, key);
  bool get editing => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final current = widget.existing;
    name = TextEditingController(text: current?['displayName']?.toString() ?? '');
    relationship = TextEditingController(text: current?['relationship']?.toString() ?? '');
    phone = TextEditingController(text: current?['phone']?.toString() ?? '');
    priority = TextEditingController(text: current?['priority']?.toString() ?? '1');
  }

  @override
  void dispose() {
    name.dispose();
    relationship.dispose();
    phone.dispose();
    priority.dispose();
    super.dispose();
  }

  String? validate() {
    if (name.text.trim().isEmpty || relationship.text.trim().isEmpty || phone.text.trim().isEmpty) return t('required');
    if (name.text.trim().length > 120 || relationship.text.trim().length > 80 || phone.text.trim().length > 40) return t('tooLong');
    final parsedPriority = int.tryParse(priority.text.trim());
    if (parsedPriority == null || parsedPriority < 1 || parsedPriority > 10) return t('priorityInvalid');
    final digitCount = phone.text.replaceAll(RegExp(r'\D'), '').length;
    if (digitCount < 7 || digitCount > 18) return t('phoneInvalid');
    return null;
  }

  Future<void> save() async {
    final validation = validate();
    if (validation != null) {
      setState(() => error = validation);
      return;
    }
    setState(() {
      saving = true;
      error = null;
    });
    try {
      final parsedPriority = int.parse(priority.text.trim());
      if (editing) {
        final id = widget.existing?['id']?.toString() ?? '';
        final updatedAt = widget.existing?['updatedAt']?.toString() ?? '';
        if (id.isEmpty || updatedAt.isEmpty) throw const CarePointApiException('Emergency contact is stale.');
        await widget.session.api.updateEmergencyContact(
          contactId: id,
          displayName: name.text,
          relationship: relationship.text,
          phone: phone.text,
          priority: parsedPriority,
          expectedUpdatedAt: updatedAt,
        ).timeout(const Duration(seconds: 30));
      } else {
        await widget.session.api.createEmergencyContact(
          displayName: name.text,
          relationship: relationship.text,
          phone: phone.text,
          priority: parsedPriority,
        ).timeout(const Duration(seconds: 30));
      }
      if (mounted) Navigator.pop(context, true);
    } on CarePointApiException catch (value) {
      if (!mounted) return;
      if (value.statusCode == 409) {
        setState(() => error = t('conflict'));
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
    return AlertDialog(
      title: Text(editing ? t('editTitle') : t('addTitle')),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                key: const ValueKey('emergency-contact-name'),
                controller: name,
                enabled: !saving,
                maxLength: 120,
                textInputAction: TextInputAction.next,
                decoration: InputDecoration(labelText: t('name'), border: const OutlineInputBorder()),
              ),
              const SizedBox(height: 8),
              TextField(
                key: const ValueKey('emergency-contact-relationship'),
                controller: relationship,
                enabled: !saving,
                maxLength: 80,
                textInputAction: TextInputAction.next,
                decoration: InputDecoration(labelText: t('relationship'), border: const OutlineInputBorder()),
              ),
              const SizedBox(height: 8),
              TextField(
                key: const ValueKey('emergency-contact-phone'),
                controller: phone,
                enabled: !saving,
                maxLength: 40,
                keyboardType: TextInputType.phone,
                textInputAction: TextInputAction.next,
                decoration: InputDecoration(labelText: t('phone'), border: const OutlineInputBorder()),
              ),
              const SizedBox(height: 8),
              TextField(
                key: const ValueKey('emergency-contact-priority'),
                controller: priority,
                enabled: !saving,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(labelText: t('priority'), helperText: t('priorityHint'), border: const OutlineInputBorder()),
              ),
              if (error != null) ...[
                const SizedBox(height: 10),
                Semantics(liveRegion: true, child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: saving ? null : () => Navigator.pop(context, false), child: Text(t('cancel'))),
        FilledButton(
          key: const ValueKey('emergency-contact-save'),
          onPressed: saving ? null : save,
          child: saving
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : Text(t('save')),
        ),
      ],
    );
  }
}

String emergencyContactText(CarePointLocale locale, String key) =>
    _emergencyContactText[locale.name]?[key] ?? _emergencyContactText['en']?[key] ?? key;

const Map<String, Map<String, String>> _emergencyContactText = {
  'en': {
    'title': 'Emergency contacts',
    'open': 'Manage emergency contacts',
    'hint': 'Add up to 10 people CarePoint can identify as your emergency contacts. Priority 1 is the first contact to use.',
    'add': 'Add contact',
    'edit': 'Edit',
    'remove': 'Remove',
    'reload': 'Reload',
    'empty': 'No emergency contacts have been added yet.',
    'limitReached': 'The maximum of 10 active emergency contacts has been reached.',
    'addTitle': 'Add emergency contact',
    'editTitle': 'Edit emergency contact',
    'name': 'Contact name',
    'relationship': 'Relationship',
    'phone': 'Phone number',
    'priority': 'Priority',
    'priorityHint': 'Use a number from 1 to 10. Each active contact needs a different priority.',
    'save': 'Save',
    'cancel': 'Cancel',
    'required': 'Name, relationship and phone are required.',
    'tooLong': 'One or more values are too long.',
    'priorityInvalid': 'Priority must be a number from 1 to 10.',
    'phoneInvalid': 'Enter a valid phone number with 7 to 18 digits.',
    'conflict': 'That priority is already in use or this contact changed. Reload and try again.',
    'invalid': 'Check the contact information and try again.',
    'loadFailed': 'Unable to load emergency contacts. Try again.',
    'saveFailed': 'Unable to save this emergency contact. Try again.',
    'removeTitle': 'Remove emergency contact?',
    'removeConfirm': 'Remove {name} from your active emergency contacts?',
    'removeFailed': 'Unable to remove this emergency contact. Try again.',
  },
  'ar': {
    'title': 'جهات اتصال الطوارئ',
    'open': 'إدارة جهات اتصال الطوارئ',
    'hint': 'أضف حتى 10 أشخاص كجهات اتصال للطوارئ. الأولوية 1 هي جهة الاتصال الأولى للاستخدام.',
    'add': 'إضافة جهة اتصال',
    'edit': 'تعديل',
    'remove': 'إزالة',
    'reload': 'إعادة التحميل',
    'empty': 'لم تتم إضافة جهات اتصال للطوارئ بعد.',
    'limitReached': 'تم الوصول إلى الحد الأقصى وهو 10 جهات اتصال نشطة.',
    'addTitle': 'إضافة جهة اتصال للطوارئ',
    'editTitle': 'تعديل جهة اتصال الطوارئ',
    'name': 'اسم جهة الاتصال',
    'relationship': 'صلة القرابة أو العلاقة',
    'phone': 'رقم الهاتف',
    'priority': 'الأولوية',
    'priorityHint': 'استخدم رقماً من 1 إلى 10. يجب أن تكون أولوية كل جهة اتصال نشطة مختلفة.',
    'save': 'حفظ',
    'cancel': 'إلغاء',
    'required': 'الاسم والعلاقة ورقم الهاتف مطلوبة.',
    'tooLong': 'إحدى القيم أو أكثر طويلة جداً.',
    'priorityInvalid': 'يجب أن تكون الأولوية رقماً من 1 إلى 10.',
    'phoneInvalid': 'أدخل رقم هاتف صالحاً يحتوي على 7 إلى 18 رقماً.',
    'conflict': 'الأولوية مستخدمة بالفعل أو تم تعديل جهة الاتصال. أعد التحميل وحاول مجدداً.',
    'invalid': 'تحقق من بيانات جهة الاتصال وحاول مجدداً.',
    'loadFailed': 'تعذر تحميل جهات اتصال الطوارئ. حاول مجدداً.',
    'saveFailed': 'تعذر حفظ جهة اتصال الطوارئ. حاول مجدداً.',
    'removeTitle': 'إزالة جهة اتصال الطوارئ؟',
    'removeConfirm': 'هل تريد إزالة {name} من جهات اتصال الطوارئ النشطة؟',
    'removeFailed': 'تعذر إزالة جهة اتصال الطوارئ. حاول مجدداً.',
  },
  'fr': {
    'title': 'Contacts d’urgence',
    'open': 'Gérer les contacts d’urgence',
    'hint': 'Ajoutez jusqu’à 10 personnes comme contacts d’urgence. La priorité 1 est le premier contact à utiliser.',
    'add': 'Ajouter un contact',
    'edit': 'Modifier',
    'remove': 'Supprimer',
    'reload': 'Recharger',
    'empty': 'Aucun contact d’urgence n’a encore été ajouté.',
    'limitReached': 'La limite de 10 contacts d’urgence actifs est atteinte.',
    'addTitle': 'Ajouter un contact d’urgence',
    'editTitle': 'Modifier le contact d’urgence',
    'name': 'Nom du contact',
    'relationship': 'Lien',
    'phone': 'Numéro de téléphone',
    'priority': 'Priorité',
    'priorityHint': 'Utilisez un nombre de 1 à 10. Chaque contact actif doit avoir une priorité différente.',
    'save': 'Enregistrer',
    'cancel': 'Annuler',
    'required': 'Le nom, le lien et le téléphone sont obligatoires.',
    'tooLong': 'Une ou plusieurs valeurs sont trop longues.',
    'priorityInvalid': 'La priorité doit être un nombre de 1 à 10.',
    'phoneInvalid': 'Saisissez un numéro valide contenant 7 à 18 chiffres.',
    'conflict': 'Cette priorité est déjà utilisée ou le contact a changé. Rechargez puis réessayez.',
    'invalid': 'Vérifiez les informations du contact puis réessayez.',
    'loadFailed': 'Impossible de charger les contacts d’urgence. Réessayez.',
    'saveFailed': 'Impossible d’enregistrer ce contact d’urgence. Réessayez.',
    'removeTitle': 'Supprimer le contact d’urgence ?',
    'removeConfirm': 'Supprimer {name} de vos contacts d’urgence actifs ?',
    'removeFailed': 'Impossible de supprimer ce contact d’urgence. Réessayez.',
  },
  'es': {
    'title': 'Contactos de emergencia',
    'open': 'Gestionar contactos de emergencia',
    'hint': 'Añade hasta 10 personas como contactos de emergencia. La prioridad 1 es el primer contacto que se utilizará.',
    'add': 'Añadir contacto',
    'edit': 'Editar',
    'remove': 'Eliminar',
    'reload': 'Recargar',
    'empty': 'Todavía no has añadido contactos de emergencia.',
    'limitReached': 'Se ha alcanzado el máximo de 10 contactos de emergencia activos.',
    'addTitle': 'Añadir contacto de emergencia',
    'editTitle': 'Editar contacto de emergencia',
    'name': 'Nombre del contacto',
    'relationship': 'Relación',
    'phone': 'Número de teléfono',
    'priority': 'Prioridad',
    'priorityHint': 'Usa un número del 1 al 10. Cada contacto activo necesita una prioridad diferente.',
    'save': 'Guardar',
    'cancel': 'Cancelar',
    'required': 'Nombre, relación y teléfono son obligatorios.',
    'tooLong': 'Uno o varios valores son demasiado largos.',
    'priorityInvalid': 'La prioridad debe ser un número del 1 al 10.',
    'phoneInvalid': 'Introduce un teléfono válido de 7 a 18 dígitos.',
    'conflict': 'Esa prioridad ya está en uso o el contacto cambió. Recarga e inténtalo de nuevo.',
    'invalid': 'Revisa los datos del contacto e inténtalo de nuevo.',
    'loadFailed': 'No se pudieron cargar los contactos de emergencia. Inténtalo de nuevo.',
    'saveFailed': 'No se pudo guardar este contacto de emergencia. Inténtalo de nuevo.',
    'removeTitle': '¿Eliminar contacto de emergencia?',
    'removeConfirm': '¿Eliminar a {name} de tus contactos de emergencia activos?',
    'removeFailed': 'No se pudo eliminar este contacto de emergencia. Inténtalo de nuevo.',
  },
};
