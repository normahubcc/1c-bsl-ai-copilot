# Инструкция по публикации 1C BSL AI Copilot в маркетплейсы

Данное руководство описывает, как выпустить расширение в **Visual Studio Code Marketplace** (Microsoft) и **Open-VSX Registry** (официальный каталог для Cursor, VSCodium, Windsurf, Gitpod).

---

## 1. Публикация в Open-VSX (для Cursor, VSCodium, Windsurf)

Open-VSX — открытый реестр от Eclipse Foundation. Именно оттуда устанавливают расширения пользователи **Cursor**, **VSCodium** и веб-IDE.

### Шаг 1. Создание аккаунта и неймспейса
1. Перейдите на [open-vsx.org](https://open-vsx.org/) и войдите через свой GitHub-аккаунт.
2. В правом верхнем углу нажмите на аватар $\to$ **Settings** $\to$ **Access Tokens**.
3. Нажмите **Generate New Token** и сохраните полученный токен (это ваш `OVSX_PAT`).
4. Перейдите во вкладку **Namespaces** и зарегистрируйте пространство имен `normahub` (совпадает с `"publisher": "normahub"` в `package.json`).

### Шаг 2. Публикация
В терминале репозитория выполните:
```bash
export OVSX_PAT="ваш_токен_open_vsx"
./publish.sh
```
Или напрямую:
```bash
npx ovsx publish 1c-bsl-ai-copilot-1.0.0.vsix --pat "$OVSX_PAT"
```
После этого расширение появится на `https://open-vsx.org/extension/normahub/1c-bsl-ai-copilot` и станет доступно для поиска прямо внутри Cursor!

---

## 2. Публикация в Visual Studio Marketplace (Microsoft VS Code)

### Шаг 1. Создание Publisher в Microsoft
1. Откройте [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage).
2. Войдите под учетной записью Microsoft.
3. Нажмите **Create publisher** и укажите:
   - **ID**: `normahub` (обязательно совпадает с `"publisher": "normahub"` в `package.json`).
   - **Name**: `NormaHub`.

### Шаг 2. Создание Personal Access Token (PAT) в Azure DevOps
1. Перейдите на [dev.azure.com](https://dev.azure.com/).
2. В правом верхнем углу нажмите иконку пользователя $\to$ **User settings** $\to$ **Personal access tokens**.
3. Нажмите **New Token**:
   - **Organization**: выберите `All accessible organizations`.
   - **Scopes**: выберите `Custom defined`, найдите раздел **Marketplace** и отметьте галку `Manage`.
4. Нажмите **Create** и скопируйте сгенерированный токен (это ваш `VSCE_PAT`).

### Шаг 3. Публикация
```bash
export VSCE_PAT="ваш_токен_azure_devops"
./publish.sh
```
Или напрямую:
```bash
npx @vscode/vsce@2.24.0 publish -p "$VSCE_PAT" --packagePath 1c-bsl-ai-copilot-1.0.0.vsix
```
После загрузки расширение проходит автоматическую валидацию Microsoft (2–5 минут) и становится доступно в официальном каталоге VS Code по всему миру.

---

## 3. Автоматический релиз через GitHub Actions (CI/CD)

В репозитории уже настроен workflow `.github/workflows/release.yml`.

1. Добавьте секреты в ваш GitHub-репозиторий (**Settings $\to$ Secrets and variables $\to$ Actions**):
   - `OVSX_PAT`: токен от Open-VSX.
   - `VSCE_PAT`: токен от Microsoft Azure DevOps.
2. Для выпуска нового релиза просто создайте и запушьте тег версии:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
3. GitHub Actions автоматически:
   - Прогонит все тесты (TypeScript + Python).
   - Соберет чистые бандлы и `.vsix` пакет.
   - Создаст **GitHub Release** с прикрепленным файлом `1c-bsl-ai-copilot-1.0.0.vsix`, внешней обработкой EPF и TurboConf скриптом.
   - Опубликует расширение одновременно в **Open-VSX (Cursor)** и **VS Code Marketplace (Microsoft)**.

---

## 4. Прямая установка без публикации (Offline / Корпоративный контур)

Пользователи могут установить расширение в 1 клик без маркетплейсов:
```bash
# Для Cursor:
cursor --install-extension 1c-bsl-ai-copilot-1.0.0.vsix

# Для VS Code:
code --install-extension 1c-bsl-ai-copilot-1.0.0.vsix
```
Или через интерфейс: `Панель расширений (Ctrl+Shift+X) -> Меню '...' -> Install from VSIX...`.
