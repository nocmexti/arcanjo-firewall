# HEIMDALL - plano de implementacao

## Objetivo

Transformar o Fleet Guardian em HEIMDALL, um manager centralizado para pfSense com operacao segura, auditoria, RBAC administravel e comunicacao feita por agente proprio. A meta e abandonar o uso recorrente do usuario `admin` local dos firewalls e reduzir a dependencia de senhas padrao.

## Fluxo de onboarding dos firewalls

### 1. Validacao inicial

Script: `check-firewall-passwords`

Objetivo:
- Validar DNS/DDNS, porta SSH e credencial temporaria de implantacao.
- Separar equipamentos com porta customizada.
- Gerar relatorio CSV por status.

Saida esperada:
- Firewall acessivel por SSH.
- Senha temporaria confirmada apenas para bootstrap.
- Lista limpa para a etapa de instalacao.

### 2. Instalacao da REST API

Script: `install-pfsense-restapi`

Objetivo:
- Detectar versao do pfSense.
- Instalar o pacote REST API correto para a familia 2.5, 2.6, 2.7 ou 2.8.
- Aplicar configuracao minima de API sem alterar politicas sensiveis fora do escopo.

Saida esperada:
- REST API ativa na porta padrao corporativa.
- API key criada para bootstrap.
- Resultado registrado em CSV.

### 3. Instalacao do agente seguro HEIMDALL

Script: `install-fleet-guardian-agent`, a renomear para `install-heimdall-agent`.

Objetivo:
- Instalar o agente PHP no WebGUI do pfSense.
- Criar segredo local unico por firewall.
- Permitir backup completo, Direct View e futuras operacoes que a REST API nao cobre bem.
- Reduzir dependencia do usuario `admin` local.

Saida esperada:
- `/fleet-guardian-agent.php?action=health` responde JSON.
- Segredo do agente salvo no cofre/CSV seguro para importacao no HEIMDALL.
- Direct View autenticado por HMAC.

## Evolucao de seguranca da aplicacao

### Fase A - Identidade HEIMDALL

Status: iniciado.

Itens:
- Renomear interface para HEIMDALL.
- Usar `public/logo.png` como logo oficial.
- Ajustar copy de login, sidebar e metadata.

### Fase B - Login corporativo

Itens:
- Exigir e-mail confirmado antes de liberar acesso.
- Aplicar politica minima de senha.
- Bloquear cadastro aberto quando o primeiro ADM ja existir, usando convite ou aprovacao.
- Registrar eventos de login, logout, falha e troca de senha.

### Fase C - MFA/TOTP

Itens:
- Exigir TOTP para `admin` e `operator`.
- Permitir viewer sem MFA apenas se politica do tenant permitir.
- Bloquear acoes sensiveis quando o usuario nao tiver fator verificado.
- Criar tela de enrollment, recovery codes e reset por ADM.

### Fase D - RBAC administravel

Itens:
- Criar papeis customizaveis pelo ADM.
- Separar permissoes por dominio:
  - inventario: ler/criar/editar/remover
  - firewall: ler/alterar regras
  - vpn: ler/kill users
  - backup: criar/importar/download/apagar
  - agente: instalar/rotacionar segredo/direct view
  - auditoria: ler/exportar
  - usuarios: convidar/bloquear/alterar papeis
- Manter os papeis base: ADM, Operador, Auditor, Leitura.

### Fase E - Remocao do admin local do fluxo diario

Itens:
- Criar usuario/role dedicado no pfSense apenas para bootstrap, com menor privilegio possivel.
- Usar API key e agente HMAC para operacao continua.
- Rotacionar o segredo do agente periodicamente.
- Registrar fingerprint do firewall e validar identidade antes de aceitar comandos.

## Ordem recomendada

1. Branding HEIMDALL.
2. Validacao de importacao/backup e historico.
3. Renomear scripts para `heimdall-*` mantendo aliases antigos.
4. Criar schema de permissoes RBAC.
5. Implementar UI de usuarios, convites e papeis.
6. Implementar TOTP e enforcement por acao sensivel.
7. Criar instalador final em tres fases: check, restapi, agent.
8. Migrar credenciais para cofre/banco criptografado e abandonar CSV em producao.
