# HEIMDALL

Raiz operacional do projeto HEIMDALL.

## Estrutura

- `agente/`: scripts de preparacao, validacao, instalacao e agente remoto.
- `conf/`: listas, resultados, padroes e arquivos de configuracao operacional.
- `conf/secrets/`: credenciais e tokens. Nao versionar.
- `api/`: pacotes da API REST publicados pelo servidor HEIMDALL.
- `api/packages/`: pacotes separados por versao de appliance.
- `backups/local/`: backups XML persistentes fora do container.
- `template/Fleet Guardian/`: template inicial preservado do projeto recebido.

## Fluxo recomendado

1. Validar acesso com `agente/check-firewall-passwords.*`.
2. Instalar o pacote REST usando `agente/install-pfsense-restapi.*`.
3. Instalar o agente seguro com `agente/install-fleet-guardian-agent.*`.
4. Operar pelo manager HEIMDALL.
