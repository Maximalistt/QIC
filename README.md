# QIC

Мессенджер в стиле ICQ начала 2000-х.

## Локальный запуск

```bash
npm install
npm start
```

Откройте http://localhost:3000

## Установка на сервер (Ubuntu / Debian)

```bash
git clone https://github.com/Maximalistt/QIC.git
cd QIC
git checkout claude/build-qic-messenger-bzYt1
sudo bash deploy/install.sh
```

Скрипт ставит Node.js, копирует приложение в `/opt/qic` и запускает его как службу `qic` на порту 80.
В конце он печатает адрес, по которому открывается чат. Другой порт: `sudo bash deploy/install.sh 3000`.

Обновление: `git pull` и снова `sudo bash deploy/install.sh`. Данные пользователей хранятся в `/var/lib/qic` и не теряются.

Полезные команды:

```bash
systemctl status qic       # работает ли
journalctl -u qic -f       # логи
sudo systemctl restart qic # перезапуск
```
