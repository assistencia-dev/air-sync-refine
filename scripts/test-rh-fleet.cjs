const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261124201200_dbs_fleet_location_tracking_and_sos.sql"), "utf8");
const functions = fs.readFileSync(path.join(root, "src/lib/ponto.functions.ts"), "utf8");
const fleet = fs.readFileSync(path.join(root, "src/components/DbsFleetWorkspace.tsx"), "utf8");
const pontoWorkspace = fs.readFileSync(path.join(root, "src/components/RhPontoWorkspace.tsx"), "utf8");

for (const table of [
  "rh_employee_location_sessions",
  "rh_employee_location_points",
  "rh_employee_sos_alerts",
]) {
  assert.match(migration, new RegExp("CREATE TABLE IF NOT EXISTS public\\." + table), table + " deve ser criada.");
  assert.match(migration, new RegExp("ALTER TABLE public\\." + table + " ENABLE ROW LEVEL SECURITY"), table + " deve ter RLS.");
  assert.match(migration, new RegExp("REVOKE ALL ON public\\." + table + " FROM anon, authenticated"), table + " não deve ser acessível pela Data API.");
  assert.match(migration, new RegExp("GRANT ALL ON public\\." + table + " TO service_role"), table + " deve ser acessível somente pelo servidor.");
}

assert.match(migration, /lunch_break/, "A sessão deve registrar pausa de almoço.");
assert.match(migration, /location_recorded_at timestamptz/, "O SOS deve preservar a hora da localização exibida.");
assert.match(migration, /location_source text CHECK/, "O SOS deve identificar se a posição veio do GPS atual ou do último ponto conhecido.");
assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pg_cron/, "A retenção deve ter agendamento automático no Postgres.");
assert.match(migration, /cron\.schedule\(/, "A limpeza de retenção deve estar agendada diariamente.");
assert.match(migration, /dbs_fleet_cleanup_retention/, "A função de retenção automática deve existir.");
assert.match(migration, /rh_employee_location_sessions_one_active_employee/, "Deve impedir duas sessões simultâneas por funcionário.");
assert.match(migration, /accuracy_m numeric\(10,2\) NOT NULL CHECK \(accuracy_m BETWEEN 0 AND 250\)/, "Pontos devem ter limite de precisão.");

for (const fn of [
  "getMyFleetStatus",
  "startMyFleetTracking",
  "recordMyFleetPosition",
  "stopMyFleetTracking",
  "sendMyFleetSos",
  "listRhFleetOverview",
  "listRhFleetSessionRoute",
  "updateRhFleetSos",
]) {
  assert.match(functions, new RegExp("export const " + fn + " = createServerFn"), fn + " deve existir como função de servidor.");
}

assert.match(functions, /async function getEmployee\(contextUserId: string\)/, "Cada colaborador deve ser identificado pelo vínculo RH autenticado.");
assert.match(functions, /async function requireRh\(context: \{ userId: string \}\)/, "As consultas administrativas devem usar autorização RH.");
assert.match(functions, /onBreak: types\.includes\("almoco_saida"\) && !types\.includes\("almoco_retorno"\)/, "O intervalo de almoço deve pausar a coleta.");
assert.match(functions, /end_reason: endReason/, "As batidas de almoço e saída devem encerrar a sessão.");
assert.match(functions, /attendance\.onBreak \? "lunch_break"/, "O servidor deve encerrar a sessão quando entrar em intervalo.");
assert.match(functions, /consent: boolean/, "O início da sessão deve receber consentimento explícito.");
assert.match(functions, /input\?\.consent !== true/, "O servidor deve recusar início sem consentimento.");
assert.match(functions, /accuracy_m > 250/, "O servidor deve rejeitar leituras imprecisas.");
assert.match(functions, /now\.getTime\(\) - Date\.parse\(session\.last_position_at\) < 20_000/, "O servidor deve aplicar intervalo mínimo de gravação.");
assert.match(functions, /elapsed >= 60_000 \|\| movedMeters >= 50/, "A trilha deve ser limitada por tempo ou deslocamento.");
assert.match(functions, /14 \* 60 \* 60 \* 1000/, "Sessões devem expirar em até 14 horas.");
assert.match(functions, /30 \* 24 \* 60 \* 60 \* 1000/, "Pontos de localização devem ter retenção de 30 dias.");
assert.match(functions, /90 \* 24 \* 60 \* 60 \* 1000/, "Alertas SOS resolvidos devem ter retenção de 90 dias.");
assert.match(functions, /sosAvailable: attendance\.hasEntry && !attendance\.hasExit/, "SOS deve continuar acessível durante intervalo autorizado da jornada.");
assert.match(functions, /existingAlerts\?\.\[0\]/, "SOS aberto existente deve evitar duplicação de alertas.");
assert.match(functions, /location_recorded_at: locationRecordedAt/, "O alerta deve guardar a hora da localização apresentada.");
assert.match(functions, /locationSource = hasCurrentSosLocation \? "current_sos"/, "O servidor deve distinguir GPS atual de última posição conhecida.");
assert.match(functions, /DBS_FLEET_TRACKING_STARTED/, "O consentimento e início da sessão devem ser auditados.");
assert.match(functions, /DBS_FLEET_TRACKING_STOPPED/, "O encerramento manual deve ser auditado.");
assert.match(functions, /DBS_FLEET_SOS_ACKNOWLEDGED/, "A confirmação de SOS deve ser auditada.");
assert.match(functions, /DBS_FLEET_SOS_RESOLVED/, "A resolução de SOS deve ser auditada.");
assert.match(functions, /requireRh\(context\);[\s\S]*?rh_employee_location_sessions/, "O mapa operacional deve ser restrito ao RH.");
assert.match(functions, /requireRh\(context\);[\s\S]*?rh_employee_location_points/, "O histórico de trajetos deve ser restrito ao RH.");
assert.match(functions, /!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//, "A validação de data deve usar dígitos reais, não barra invertida literal.");

assert.match(fleet, /navigator\.geolocation\.watchPosition/, "O colaborador deve compartilhar posição com GPS ativo e visível.");
assert.match(fleet, /navigator\.geolocation\.clearWatch/, "A leitura do GPS deve ser encerrada ao pausar ou desmontar.");
assert.match(fleet, /document\.visibilityState !== "visible"/, "A coleta deve pausar quando o portal sair de primeiro plano.");
assert.match(fleet, /document\.addEventListener\("visibilitychange"/, "A coleta deve retomar somente quando o portal voltar a ficar visível.");
assert.match(fleet, /Autorizo compartilhar minha localização com a administração durante esta jornada/, "A tela deve explicar e coletar consentimento.");
assert.match(fleet, /Encerrar acompanhamento/, "O colaborador deve poder interromper o acompanhamento.");
assert.match(fleet, /ENVIAR SOS/, "O colaborador deve ter botão de emergência.");
assert.match(fleet, /Confirmar recebimento/, "O RH deve conseguir confirmar o recebimento do SOS.");
assert.match(fleet, /Ver deslocamento/, "O RH deve conseguir visualizar trajetos.");
assert.match(fleet, /não rastreia em segundo plano/, "A limitação do navegador deve estar explicitada na interface.");
assert.match(pontoWorkspace, /DbsFleetAdminPanel/, "O DBS FLEET deve estar acessível no RH.");
assert.match(pontoWorkspace, /DbsFleetEmployeePanel/, "O DBS FLEET deve estar acessível no portal do colaborador.");
assert.match(pontoWorkspace, /view==="acessos" \? <section[\s\S]*?<DbsFleetAdminPanel \/>/, "A nova aba do FLEET não pode substituir Acessos e jornada.");
assert.match(fleet, /status\.data\?\.sosAvailable/, "O SOS deve permanecer acessível durante o intervalo da jornada.");

console.log("DBS FLEET: consentimento, GPS em primeiro plano, pausa no almoço, retenção, RLS, mapa RH e SOS verificados.");
