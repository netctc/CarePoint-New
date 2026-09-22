"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "@/components/B6GovernanceCenter.module.css";

const cards={
 en:[["ADM-084","Clinical terminology","Versioned coding systems and concepts.","/clinical-terminology"],["ADM-088","Patient data quality","Reproducible findings and governed remediation.","/data-quality/patients"],["ADM-090","Controlled patient merge","Preview conflicts before identity merge.","/data-quality/merge"],["ADM-100","Notification templates","PHI-safe EN/AR/FR/ES multichannel text.","/notification-templates"],["ADM-101","Feature governance","Backend-enforced rollout policies.","/features"],["ADM-110","Localization","Versioned dynamic EN/AR/FR/ES content.","/localization"]],
 ar:[["ADM-084","المصطلحات السريرية","أنظمة ترميز ومفاهيم ذات إصدارات.","/clinical-terminology"],["ADM-088","جودة بيانات المرضى","نتائج قابلة للتكرار ومعالجة محكومة.","/data-quality/patients"],["ADM-090","دمج المرضى","معاينة التعارضات قبل دمج الهوية.","/data-quality/merge"],["ADM-100","قوالب الإشعارات","نص آمن متعدد القنوات بأربع لغات.","/notification-templates"],["ADM-101","حوكمة الميزات","سياسات إطلاق يفرضها الخادم.","/features"],["ADM-110","الترجمة","محتوى ديناميكي بإصدارات بأربع لغات.","/localization"]],
 fr:[["ADM-084","Terminologie clinique","Systèmes et concepts de codage versionnés.","/clinical-terminology"],["ADM-088","Qualité des données","Constats reproductibles et remédiation gouvernée.","/data-quality/patients"],["ADM-090","Fusion patient contrôlée","Prévisualisation des conflits avant fusion.","/data-quality/merge"],["ADM-100","Modèles de notification","Texte multicanal sans PHI en quatre langues.","/notification-templates"],["ADM-101","Gouvernance des features","Politiques de rollout imposées par le backend.","/features"],["ADM-110","Localisation","Contenu dynamique versionné EN/AR/FR/ES.","/localization"]],
 es:[["ADM-084","Terminología clínica","Sistemas de códigos y conceptos versionados.","/clinical-terminology"],["ADM-088","Calidad de datos","Hallazgos reproducibles y remediación gobernada.","/data-quality/patients"],["ADM-090","Fusión controlada","Previsualización de conflictos antes de fusionar.","/data-quality/merge"],["ADM-100","Plantillas de notificación","Texto multicanal sin PHI en cuatro idiomas.","/notification-templates"],["ADM-101","Gobernanza de features","Políticas de rollout impuestas también por backend.","/features"],["ADM-110","Localización","Contenido dinámico versionado EN/AR/FR/ES.","/localization"]],
} satisfies Record<Locale,string[][]>;

export default function GovernancePage(){const {locale}=useI18n();return <AppShell active="12" eyebrow="V2 · B6" title="Governance Center"><div className={styles.hub}>{cards[locale].map(([id,title,description,href])=><Link key={id} href={href}><small>{id}</small><strong>{title}</strong><span>{description}</span></Link>)}</div></AppShell>;}
