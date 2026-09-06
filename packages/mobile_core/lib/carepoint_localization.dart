import 'package:flutter/widgets.dart';

enum CarePointLocale { en, ar, fr, es }

extension CarePointLocaleInfo on CarePointLocale {
  Locale get locale => Locale(name);
  TextDirection get textDirection => this == CarePointLocale.ar ? TextDirection.rtl : TextDirection.ltr;
  String get label => switch (this) {
    CarePointLocale.en => 'English',
    CarePointLocale.ar => 'العربية',
    CarePointLocale.fr => 'Français',
    CarePointLocale.es => 'Español',
  };
}

const Map<CarePointLocale, Map<String, String>> messages = {
  CarePointLocale.en: {
    'patient.greeting': 'Good morning, Maya', 'patient.prompt': 'What do you need today?', 'patient.emergency': 'EMERGENCY AMBULANCE', 'patient.emergencyAction': 'Request urgent help', 'patient.emergencyHint': 'One tap · current location · priority dispatch', 'patient.book': 'Book visit', 'patient.telemedicine': 'Telemedicine', 'patient.homeCare': 'Home care', 'patient.findCare': 'Find care', 'patient.emergencyTitle': 'Emergency ambulance', 'patient.emergencyText': 'Your current location will be used to request the nearest eligible emergency ambulance. No provider search or ordinary booking is required.', 'patient.requestNow': 'Request ambulance now', 'patient.cancel': 'Cancel',
    'doctor.title': 'Doctor · Today', 'doctor.boundary': 'ALL SPECIALTIES · ONE DOCTOR DOMAIN', 'doctor.queue': 'Clinical queue',
    'provider.title': 'CarePoint Provider', 'provider.boundary': 'NON-DOCTOR PROVIDER DOMAIN', 'provider.route': 'Service route', 'provider.nextJob': 'NEXT FIELD JOB', 'provider.nursing': 'Home nursing visit', 'provider.startRoute': 'Start route', 'provider.note': 'This application serves all non-doctor healthcare and medical transport categories. Doctors use the separate Doctor application.'
  },
  CarePointLocale.ar: {
    'patient.greeting': 'صباح الخير، مايا', 'patient.prompt': 'ما الذي تحتاجينه اليوم؟', 'patient.emergency': 'إسعاف طارئ', 'patient.emergencyAction': 'اطلب مساعدة عاجلة', 'patient.emergencyHint': 'لمسة واحدة · موقعك الحالي · إرسال بالأولوية', 'patient.book': 'احجز زيارة', 'patient.telemedicine': 'طب عن بُعد', 'patient.homeCare': 'رعاية منزلية', 'patient.findCare': 'ابحث عن رعاية', 'patient.emergencyTitle': 'إسعاف طارئ', 'patient.emergencyText': 'سيُستخدم موقعك الحالي لطلب أقرب سيارة إسعاف طارئة مؤهلة، من دون البحث عن مقدم خدمة أو حجز عادي.', 'patient.requestNow': 'اطلب الإسعاف الآن', 'patient.cancel': 'إلغاء',
    'doctor.title': 'الطبيب · اليوم', 'doctor.boundary': 'كل التخصصات · نطاق أطباء واحد', 'doctor.queue': 'قائمة الحالات السريرية',
    'provider.title': 'مقدم خدمة CarePoint', 'provider.boundary': 'نطاق مقدمي الرعاية غير الأطباء', 'provider.route': 'مسار الخدمة', 'provider.nextJob': 'المهمة الميدانية التالية', 'provider.nursing': 'زيارة تمريض منزلية', 'provider.startRoute': 'ابدأ المسار', 'provider.note': 'هذا التطبيق يخدم جميع فئات الرعاية الصحية غير الأطباء والنقل الطبي. يستخدم الأطباء تطبيق الأطباء المنفصل.'
  },
  CarePointLocale.fr: {
    'patient.greeting': 'Bonjour, Maya', 'patient.prompt': 'De quoi avez-vous besoin aujourd’hui ?', 'patient.emergency': 'AMBULANCE D’URGENCE', 'patient.emergencyAction': 'Demander une aide urgente', 'patient.emergencyHint': 'Un geste · position actuelle · dispatch prioritaire', 'patient.book': 'Prendre rendez-vous', 'patient.telemedicine': 'Télémédecine', 'patient.homeCare': 'Soins à domicile', 'patient.findCare': 'Trouver des soins', 'patient.emergencyTitle': 'Ambulance d’urgence', 'patient.emergencyText': 'Votre position actuelle sera utilisée pour demander l’ambulance éligible la plus proche, sans recherche de prestataire ni réservation normale.', 'patient.requestNow': 'Demander l’ambulance maintenant', 'patient.cancel': 'Annuler',
    'doctor.title': 'Médecin · Aujourd’hui', 'doctor.boundary': 'TOUTES SPÉCIALITÉS · UN DOMAINE MÉDECIN', 'doctor.queue': 'File clinique',
    'provider.title': 'Prestataire CarePoint', 'provider.boundary': 'DOMAINE PRESTATAIRES NON MÉDECINS', 'provider.route': 'Itinéraire de service', 'provider.nextJob': 'PROCHAINE MISSION TERRAIN', 'provider.nursing': 'Visite infirmière à domicile', 'provider.startRoute': 'Démarrer l’itinéraire', 'provider.note': 'Cette application couvre toutes les catégories de santé non médecins et de transport médical. Les médecins utilisent l’application Médecin séparée.'
  },
  CarePointLocale.es: {
    'patient.greeting': 'Buenos días, Maya', 'patient.prompt': '¿Qué necesitas hoy?', 'patient.emergency': 'AMBULANCIA DE URGENCIAS', 'patient.emergencyAction': 'Solicitar ayuda urgente', 'patient.emergencyHint': 'Un toque · ubicación actual · despacho prioritario', 'patient.book': 'Reservar visita', 'patient.telemedicine': 'Telemedicina', 'patient.homeCare': 'Atención domiciliaria', 'patient.findCare': 'Buscar atención', 'patient.emergencyTitle': 'Ambulancia de urgencias', 'patient.emergencyText': 'Se utilizará tu ubicación actual para solicitar la ambulancia elegible más cercana, sin búsqueda de proveedor ni reserva ordinaria.', 'patient.requestNow': 'Solicitar ambulancia ahora', 'patient.cancel': 'Cancelar',
    'doctor.title': 'Médico · Hoy', 'doctor.boundary': 'TODAS LAS ESPECIALIDADES · UN DOMINIO MÉDICO', 'doctor.queue': 'Cola clínica',
    'provider.title': 'Proveedor CarePoint', 'provider.boundary': 'DOMINIO DE PROVEEDORES NO MÉDICOS', 'provider.route': 'Ruta de servicio', 'provider.nextJob': 'PRÓXIMO TRABAJO DE CAMPO', 'provider.nursing': 'Visita de enfermería a domicilio', 'provider.startRoute': 'Iniciar ruta', 'provider.note': 'Esta aplicación sirve a todas las categorías sanitarias no médicas y de transporte médico. Los médicos utilizan la aplicación Médicos separada.'
  },
};

String cpText(CarePointLocale locale, String key) => messages[locale]?[key] ?? messages[CarePointLocale.en]?[key] ?? key;
