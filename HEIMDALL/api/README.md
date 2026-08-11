# API

Hospedagem local dos pacotes REST usados pelo HEIMDALL.

Coloque os pacotes oficiais em:

- `packages/2.5/`
- `packages/2.6/`
- `packages/2.7/`
- `packages/2.8/`

O script de instalacao deve apontar para o servidor HEIMDALL em vez de baixar do GitHub.
Mantenha o nome do arquivo igual ao esperado pelo instalador para evitar erro de versao.

Exemplo:

```powershell
.\agente\install-pfsense-restapi.bat -Install -PackageBaseUrl https://heimdall.seudominio/api/packages
```
