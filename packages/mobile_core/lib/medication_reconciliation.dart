import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

const _outcomes = ['CONTINUE','SUSPEND','DUPLICATE','CORRECT','MATCHED'];

class DoctorMedicationReconciliationPage extends StatefulWidget {
  const DoctorMedicationReconciliationPage({
    super.key,
    required this.session,
    required this.locale,
    required this.patientId,
  });
  final CarePointSession session;
  final CarePointLocale locale;
  final String patientId;

  @override
  State<DoctorMedicationReconciliationPage> createState() => _DoctorMedicationReconciliationPageState();
}

class _DoctorMedicationReconciliationPageState extends State<DoctorMedicationReconciliationPage> {
  bool loading = true;
  bool saving = false;
  String? error;
  List<Map<String,dynamic>> statements = const [];
  List<Map<String,dynamic>> prescriptions = const [];
  Map<String,dynamic>? latest;
  final Map<String,Map<String,dynamic>> decisions = {};

  CarePointApi get api => widget.session.api;
  String t(String key) => medicationReconciliationText(widget.locale, key);

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final values = await Future.wait([
        api.doctorClinicalProfileEntries(widget.patientId, kind: 'MEDICATION'),
        api.providerClinicalOrders(widget.patientId),
        api.doctorMedicationReconciliation(widget.patientId),
      ]);
      final profile = _map(values[0]);
      final orders = _maps(_map(values[1])['items'])
          .where((item) => item['type'] == 'PRESCRIPTION')
          .toList(growable:false);
      final current = _map(_map(values[2])['reconciliation']);
      final nextDecisions = <String,Map<String,dynamic>>{};
      for (final item in _maps(current['items'])) {
        final statement = _map(item['statement']);
        final id = statement['id']?.toString();
        if (id == null || id.isEmpty) continue;
        nextDecisions[id] = {
          'statementEntryId': id,
          if (_map(item['prescription']).isNotEmpty) 'prescriptionOrderId': _map(item['prescription'])['id'],
          'outcome': item['outcome'],
          'resolutionStatus': item['resolutionStatus'],
          if (item['reason'] != null) 'reason': item['reason'],
        };
      }
      if (mounted) setState(() {
        statements = _maps(profile['items']);
        prescriptions = orders;
        latest = current.isEmpty ? null : current;
        decisions
          ..clear()
          ..addAll(nextDecisions);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(t('doctorTitle')),
      actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))],
    ),
    body: loading
        ? const Center(child: CircularProgressIndicator())
        : error != null
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
            : ListView(
                padding: const EdgeInsets.fromLTRB(12,12,12,100),
                children: [
                  _statusCard(),
                  const SizedBox(height: 12),
                  if (statements.isEmpty)
                    Card(child: Padding(padding: const EdgeInsets.all(18), child: Text(t('noStatements'))))
                  else
                    ...statements.map(_statementCard),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    key: const ValueKey('doctor-medication-reconciliation-save'),
                    onPressed: saving || decisions.isEmpty ? null : _save,
                    icon: const Icon(Icons.verified_outlined),
                    label: Text(t('signSnapshot')),
                  ),
                ],
              ),
  );

  Widget _statusCard() {
    final current = latest;
    final open = current == null
        ? 0
        : _maps(current['items']).where((item) => item['resolutionStatus'] == 'OPEN').length;
    return Card(child: ListTile(
      leading: Icon(open > 0 ? Icons.warning_amber_outlined : Icons.verified_outlined),
      title: Text(current == null ? t('neverReconciled') : '${t('version')} ${current['version'] ?? ''} · ${current['status'] ?? ''}'),
      subtitle: Text(current == null
          ? t('selectItems')
          : '${t('openDiscrepancies')}: $open\n${t('lastProfessional')}: ${_map(current['lastProfessional'])['displayName'] ?? _map(current['lastProfessional'])['providerId'] ?? '—'}'),
      isThreeLine: current != null,
    ));
  }

  Widget _statementCard(Map<String,dynamic> statement) {
    final data = _map(statement['data']);
    final provenance = _map(statement['provenance']);
    final id = statement['id']?.toString() ?? '';
    final decision = decisions[id];
    return Card(child: ListTile(
      leading: const Icon(Icons.medication_outlined),
      title: Text(data['name']?.toString() ?? t('medication')),
      subtitle: Text([
        if (data['dose'] != null) data['dose'].toString(),
        '${t('source')}: ${provenance['sourceType'] ?? '—'}',
        if (decision != null) '${t('decision')}: ${decision['outcome']} · ${decision['resolutionStatus']}',
      ].join('\n')),
      isThreeLine: true,
      trailing: IconButton(
        key: ValueKey('med-reconcile-$id'),
        onPressed: () => _editDecision(statement),
        icon: Icon(decision == null ? Icons.add_task_outlined : Icons.edit_note_outlined),
        tooltip: t('decision'),
      ),
    ));
  }

  Future<void> _editDecision(Map<String,dynamic> statement) async {
    final id = statement['id'].toString();
    final existing = decisions[id];
    String outcome = existing?['outcome']?.toString() ?? 'CONTINUE';
    String resolution = existing?['resolutionStatus']?.toString() ?? 'OPEN';
    String? prescriptionId = existing?['prescriptionOrderId']?.toString();
    final reason = TextEditingController(text: existing?['reason']?.toString() ?? '');
    final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => StatefulBuilder(
      builder: (context,setLocal) => AlertDialog(
        title: Text(t('decision')),
        content: SingleChildScrollView(child: Column(mainAxisSize:MainAxisSize.min,children:[
          DropdownButtonFormField<String>(
            initialValue: outcome,
            decoration: InputDecoration(labelText:t('outcome'),border:const OutlineInputBorder()),
            items:_outcomes.map((value)=>DropdownMenuItem(value:value,child:Text(value))).toList(),
            onChanged:(value)=>setLocal((){
              outcome=value ?? outcome;
              if(outcome=='MATCHED') resolution='RESOLVED';
            }),
          ),
          const SizedBox(height:10),
          DropdownButtonFormField<String>(
            initialValue: prescriptionId,
            decoration: InputDecoration(labelText:t('prescription'),border:const OutlineInputBorder()),
            items:[
              DropdownMenuItem<String>(value:null,child:Text(t('noPrescription'))),
              ...prescriptions.map((order){
                final med=_map(_map(order['data'])['medication']);
                return DropdownMenuItem(value:order['id'].toString(),child:Text(med['name']?.toString() ?? order['id'].toString()));
              }),
            ],
            onChanged:(value)=>setLocal(()=>prescriptionId=value),
          ),
          const SizedBox(height:10),
          DropdownButtonFormField<String>(
            initialValue: resolution,
            decoration: InputDecoration(labelText:t('resolution'),border:const OutlineInputBorder()),
            items:['OPEN','RESOLVED'].map((value)=>DropdownMenuItem(value:value,child:Text(value))).toList(),
            onChanged:outcome=='MATCHED'?null:(value)=>setLocal(()=>resolution=value ?? resolution),
          ),
          const SizedBox(height:10),
          TextField(controller:reason,maxLines:3,decoration:InputDecoration(labelText:t('reason'),border:const OutlineInputBorder())),
        ])),
        actions:[
          if(existing!=null) TextButton(onPressed:()=>Navigator.pop(dialogContext,null),child:Text(t('remove'))),
          TextButton(onPressed:()=>Navigator.pop(dialogContext,false),child:Text(t('cancel'))),
          FilledButton(onPressed:()=>Navigator.pop(dialogContext,true),child:Text(t('save'))),
        ],
      ),
    ));
    if(accepted==true){
      setState(()=>decisions[id]={
        'statementEntryId':id,
        if(prescriptionId?.isNotEmpty==true)'prescriptionOrderId':prescriptionId,
        'outcome':outcome,
        'resolutionStatus':outcome=='MATCHED'?'RESOLVED':resolution,
        if(reason.text.trim().isNotEmpty)'reason':reason.text.trim(),
      });
    } else if(accepted==null && existing!=null){
      setState(()=>decisions.remove(id));
    }
    reason.dispose();
  }

  Future<void> _save() async {
    setState(()=>saving=true);
    try{
      await api.reconcileDoctorMedications(
        widget.patientId,
        expectedLatestReconciliationId: latest?['id']?.toString(),
        items: decisions.values.toList(growable:false),
      );
      await _load();
      if(mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(t('saved'))));
    } on CarePointApiException catch(value) {
      if(value.statusCode==409) await _load();
      if(mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(value.toString())));
    } catch(value) {
      if(mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(value.toString())));
    } finally {
      if(mounted) setState(()=>saving=false);
    }
  }
}

class PatientMedicationReconciliationPage extends StatefulWidget {
  const PatientMedicationReconciliationPage({super.key,required this.session,required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;
  @override
  State<PatientMedicationReconciliationPage> createState()=>_PatientMedicationReconciliationPageState();
}

class _PatientMedicationReconciliationPageState extends State<PatientMedicationReconciliationPage>{
  bool loading=true;
  String? error;
  Map<String,dynamic>? reconciliation;
  String t(String key)=>medicationReconciliationText(widget.locale,key);

  @override
  void initState(){super.initState();_load();}

  Future<void> _load() async{
    setState((){loading=true;error=null;});
    try{
      final value=await widget.session.api.patientMedicationReconciliation();
      final current=_map(value['reconciliation']);
      if(mounted)setState(()=>reconciliation=current.isEmpty?null:current);
    }catch(value){if(mounted)setState(()=>error=value.toString());}
    finally{if(mounted)setState(()=>loading=false);}
  }

  @override
  Widget build(BuildContext context)=>Scaffold(
    appBar:AppBar(title:Text(t('patientTitle')),actions:[IconButton(onPressed:_load,icon:const Icon(Icons.refresh_outlined),tooltip:t('refresh'))]),
    body:loading?const Center(child:CircularProgressIndicator())
      :error!=null?Center(child:Padding(padding:const EdgeInsets.all(24),child:Text(error!,textAlign:TextAlign.center)))
      :reconciliation==null?Center(child:Padding(padding:const EdgeInsets.all(24),child:Text(t('neverReconciled'),textAlign:TextAlign.center)))
      :ListView(padding:const EdgeInsets.all(12),children:[
        Card(child:ListTile(
          leading:Icon(reconciliation!['status']=='OPEN'?Icons.warning_amber_outlined:Icons.verified_outlined),
          title:Text('${t('version')} ${reconciliation!['version']} · ${reconciliation!['status']}'),
          subtitle:Text('${t('lastProfessional')}: ${_map(reconciliation!['lastProfessional'])['displayName'] ?? '—'}\n${t('signed')}: ${_date(reconciliation!['signedAt'])}'),
          isThreeLine:true,
        )),
        ..._maps(reconciliation!['items']).map((item){
          final statement=_map(item['statement']);
          final data=_map(statement['data']);
          final source=statement['sourceType'] ?? _map(statement['provenance'])['sourceType'];
          return Card(child:ListTile(
            leading:const Icon(Icons.medication_outlined),
            title:Text(data['name']?.toString() ?? t('medication')),
            subtitle:Text([
              if(data['dose']!=null)data['dose'].toString(),
              '${t('source')}: ${source ?? '—'}',
              '${t('decision')}: ${item['outcome']} · ${item['resolutionStatus']}',
              if(item['reason']!=null)'${t('reason')}: ${item['reason']}',
            ].join('\n')),
            isThreeLine:true,
          ));
        }),
      ]),
  );
}

String medicationReconciliationText(CarePointLocale locale,String key){
  const values=<CarePointLocale,Map<String,String>>{
    CarePointLocale.en:{
      'doctorTitle':'Medication reconciliation','patientTitle':'Medication reconciliation status','refresh':'Refresh','neverReconciled':'No professional medication reconciliation is recorded yet.','selectItems':'Review medication statements and record explicit decisions.','openDiscrepancies':'Open discrepancies','lastProfessional':'Last professional','version':'Version','medication':'Medication','source':'Source','decision':'Decision','outcome':'Outcome','resolution':'Resolution','prescription':'Linked CarePoint prescription','noPrescription':'No linked prescription','reason':'Reason (optional)','remove':'Remove','cancel':'Cancel','save':'Save','saved':'Signed medication reconciliation saved.','signSnapshot':'Sign reconciliation snapshot','noStatements':'No medication statements are available.','signed':'Signed'
    },
    CarePointLocale.ar:{
      'doctorTitle':'مراجعة الأدوية','patientTitle':'حالة مراجعة الأدوية','refresh':'تحديث','neverReconciled':'لا توجد مراجعة مهنية للأدوية حتى الآن.','selectItems':'راجع بيانات الأدوية وسجّل قراراً صريحاً.','openDiscrepancies':'الاختلافات المفتوحة','lastProfessional':'آخر مختص','version':'الإصدار','medication':'الدواء','source':'المصدر','decision':'القرار','outcome':'النتيجة','resolution':'حالة الحل','prescription':'وصفة CarePoint المرتبطة','noPrescription':'بدون وصفة مرتبطة','reason':'السبب (اختياري)','remove':'إزالة','cancel':'إلغاء','save':'حفظ','saved':'تم حفظ مراجعة الأدوية الموقعة.','signSnapshot':'توقيع مراجعة الأدوية','noStatements':'لا توجد بيانات أدوية متاحة.','signed':'تم التوقيع'
    },
    CarePointLocale.fr:{
      'doctorTitle':'Conciliation médicamenteuse','patientTitle':'Statut de conciliation médicamenteuse','refresh':'Actualiser','neverReconciled':'Aucune conciliation médicamenteuse professionnelle enregistrée.','selectItems':'Examinez les traitements déclarés et consignez des décisions explicites.','openDiscrepancies':'Divergences ouvertes','lastProfessional':'Dernier professionnel','version':'Version','medication':'Médicament','source':'Source','decision':'Décision','outcome':'Résultat','resolution':'Résolution','prescription':'Prescription CarePoint liée','noPrescription':'Aucune prescription liée','reason':'Motif (facultatif)','remove':'Retirer','cancel':'Annuler','save':'Enregistrer','saved':'Conciliation signée enregistrée.','signSnapshot':'Signer la conciliation','noStatements':'Aucun traitement déclaré disponible.','signed':'Signée'
    },
    CarePointLocale.es:{
      'doctorTitle':'Conciliación de medicación','patientTitle':'Estado de conciliación de medicación','refresh':'Actualizar','neverReconciled':'Todavía no hay una conciliación profesional de medicación.','selectItems':'Revisa las medicaciones declaradas y registra decisiones explícitas.','openDiscrepancies':'Discrepancias abiertas','lastProfessional':'Último profesional','version':'Versión','medication':'Medicamento','source':'Origen','decision':'Decisión','outcome':'Resultado','resolution':'Resolución','prescription':'Prescripción CarePoint vinculada','noPrescription':'Sin prescripción vinculada','reason':'Motivo (opcional)','remove':'Quitar','cancel':'Cancelar','save':'Guardar','saved':'Conciliación firmada guardada.','signSnapshot':'Firmar conciliación','noStatements':'No hay medicaciones declaradas disponibles.','signed':'Firmada'
    },
  };
  return values[locale]?[key]??values[CarePointLocale.en]![key]??key;
}
Map<String,dynamic> _map(dynamic value){if(value is Map<String,dynamic>)return value;if(value is Map)return value.map((k,v)=>MapEntry(k.toString(),v));return const{};}
List<Map<String,dynamic>> _maps(dynamic value)=>value is List?value.map(_map).toList(growable:false):const[];
String _date(dynamic value){final parsed=DateTime.tryParse(value?.toString()??'');return parsed==null?'—':parsed.toLocal().toString().substring(0,16);}
