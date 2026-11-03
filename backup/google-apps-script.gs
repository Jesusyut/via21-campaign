// Optional backup only. Deploy as a Web App running as you.
// Configure SHEET_ID and BACKUP_SECRET in Script Properties (never in this file).
// Configure this Web App URL / matching secret in the SERVER's environment.
function doPost(e) {
 var lock=LockService.getScriptLock();lock.waitLock(20000);
 try {
  var props=PropertiesService.getScriptProperties(),body=JSON.parse(e.postData.contents);
  if(!props.getProperty('BACKUP_SECRET')||body.secret!==props.getProperty('BACKUP_SECRET'))return reply({success:false});
  var lead=body.lead;if(!lead||!lead.id) return reply({success:false});
  var book=SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
  var sheet=book.getSheetByName('Via21')||book.insertSheet('Via21');
  var fields=['id','created_at','first_name','last_name','phone','email','furnished','bedrooms','move_in','ad_source','utm_source','utm_campaign','utm_content','stage'];
  if(sheet.getLastRow()===0)sheet.appendRow(fields);
  var match=sheet.getRange(1,1,Math.max(1,sheet.getLastRow()),1).createTextFinder(lead.id).matchEntireCell(true).findNext();
  if(!match)sheet.appendRow(fields.map(function(key){var value=String(lead[key]||'');return /^[=+\-@\t\r]/.test(value)?"'"+value:value;}));
  return reply({success:true,id:lead.id});
 } catch(err) {return reply({success:false});} finally {lock.releaseLock();}
}
function reply(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
