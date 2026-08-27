// ============================================================
// RS AUTO — Выгрузка журнала согласий в CSV. Route Handler.
// ============================================================
// ЗАЧЕМ ОТДЕЛЬНЫЙ МАРШРУТ, А НЕ КНОПКА НА СТРАНИЦЕ. Экран
// /admin/consents показывает 50 строк на страницу — этого хватает
// посмотреть, но не хватает предъявить. Доказательство передают
// файлом: юристу, регулятору, в переписку. Здесь тот же запрос
// отдаётся целиком одним файлом с заголовками колонок.
//
// ⚠️ ЗАЩИТА ЗДЕСЬ СВОЯ. Route Handler НЕ оборачивается layout'ом
// раздела: app/admin/layout.tsx проверяет права у страниц, но к
// маршрутам-обработчикам не применяется вовсе. Без проверки внутри
// самого файла адрес /admin/consents/export отдавал бы IP-адреса
// посетителей любому, кто его наберёт. Поэтому admin_guard()
// вызывается здесь первой строкой — тем же способом, что в layout'е.
//
// Настоящий рубеж всё равно ниже: политика cookie_consents_select_admin
// (0094) отдаёт таблицу только админу, и не-админ получил бы пустой
// список даже в обход проверки. Но пустой CSV вместо 404 подтверждал
// бы существование раздела, а проверка выше отвечает так же, как
// несуществующей странице.
//
// force-dynamic: обработчик читает cookie сессии и персональные
// данные. Кэшированный ответ здесь недопустим ни при каких условиях.
// ============================================================

import { getServerClient } from '@/lib/supabaseServer';
import type { CookieConsent } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Потолок строк в одной выгрузке. Журнал согласий растёт с каждым
// первым визитом, и «выгрузить всё» на живом сайте однажды означает
// сотни тысяч строк в память процесса. Практический запрос всегда
// ограничен периодом или версией политики; если понадобится полная
// история — она берётся из SQL Editor через \copy, для чего в
// миграции 0094 приведён готовый запрос.
const MAX_ROWS = 50000;

// Экранирование поля CSV по RFC 4180.
// Кавычки, запятые и переводы строк внутри значения обязаны быть
// обёрнуты, иначе Excel развалит строку по колонкам: User-Agent
// содержит запятые всегда («Mozilla/5.0 (Windows NT 10.0; Win64, x64)»).
function csvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';

  const s = String(value);

  // Ведущие =, +, -, @ Excel трактует как начало формулы (CSV
  // injection): значение из User-Agent, начавшись с «=», выполнилось бы
  // при открытии файла. Обезвреживаем апострофом — Excel показывает
  // текст как есть и формулу не запускает.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;

  return `"${safe.replace(/"/g, '""')}"`;
}

// Время в белградской зоне с секундами. То же представление, что на
// экране /admin/consents: файл и страница обязаны показывать один и
// тот же момент одинаково, иначе сверять их бессмысленно.
//
// Формат sv-SE выбран не ради шведского языка, а ради его записи даты:
// он даёт ISO-подобное «2026-08-27 14:30:05», которое сортируется как
// строка и одинаково читается в любой локали Excel. Русский формат
// «27.08.2026» Excel в разных региональных настройках разбирает
// по-разному — то как август, то как 8-е число.
const CSV_TIME = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Belgrade',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const HEADERS = [
  'id',
  'user_id',
  'consent_at_belgrade',
  'consent_at_utc',
  'ip',
  'policy_version',
  'consents',
  'user_agent',
];

export async function GET(request: Request) {
  const supabase = await getServerClient();

  // Права. См. шапку: layout сюда не распространяется.
  // Ошибка RPC — тоже «не пускать»: отдавать персональные данные,
  // когда проверка прав не отработала, нельзя.
  const { data: isAdmin, error: guardError } =
    await supabase.rpc('admin_guard');

  if (guardError || isAdmin !== true) {
    // 404, а не 403 — по той же причине, что в app/admin/layout.tsx:
    // 403 подтверждает существование выгрузки, 404 не подтверждает
    // ничего.
    return new Response('Not found', { status: 404 });
  }

  // Фильтры принимаются те же, что на экране, и с той же семантикой:
  // модератор выгружает ровно ту выборку, которую видит.
  const url = new URL(request.url);
  const version = (url.searchParams.get('version') ?? '').trim();
  const whoParam = url.searchParams.get('who');
  const who = whoParam === 'users' || whoParam === 'guests' ? whoParam : null;

  let query = supabase
    .from('cookie_consents')
    .select('id, user_id, consent_at, ip, user_agent, policy_version, consents')
    .order('consent_at', { ascending: false })
    .limit(MAX_ROWS);

  if (version) query = query.eq('policy_version', version);
  if (who === 'users') query = query.not('user_id', 'is', null);
  if (who === 'guests') query = query.is('user_id', null);

  const { data, error } = await query;

  if (error) {
    return new Response('Export failed', { status: 500 });
  }

  const rows = (data ?? []) as CookieConsent[];

  const lines = [HEADERS.join(',')];

  for (const row of rows) {
    const at = new Date(row.consent_at);

    lines.push(
      [
        csvCell(row.id),
        // Гость выгружается пустой ячейкой, а не словом: файл читает
        // машина (фильтр, сводная таблица), и пустое значение
        // однозначно отличает отсутствие аккаунта от аккаунта с именем
        // «Гость».
        csvCell(row.user_id),
        csvCell(CSV_TIME.format(at)),
        // UTC рядом с местным временем — намеренное дублирование.
        // Местное читает человек, машинное (ISO 8601 с зоной) не
        // допускает разночтений при передаче файла за пределы Сербии
        // и переживает переход на летнее время.
        csvCell(at.toISOString()),
        csvCell(row.ip),
        csvCell(row.policy_version),
        // Категории — компактной строкой «cookies=true», а не сырым
        // JSON: фигурные скобки и кавычки внутри ячейки Excel
        // показывает как есть, и читать их в таблице неудобно.
        csvCell(
          Object.entries(row.consents ?? {})
            .map(([k, v]) => `${k}=${v}`)
            .join('; '),
        ),
        csvCell(row.user_agent),
      ].join(','),
    );
  }

  // \r\n — перевод строки по RFC 4180. Excel под Windows разбирает и
  // одиночный \n, но старые импортёры и часть бухгалтерских программ —
  // нет, а файл может уйти дальше нас.
  const csv = lines.join('\r\n');

  // BOM в начале файла ОБЯЗАТЕЛЕН. Без него Excel под Windows читает
  // CSV в системной кодировке, и кириллица в колонках превращается в
  // «РљСѓРєРё». Другие программы BOM игнорируют.
  const body = `﻿${csv}`;

  // Имя файла с датой выгрузки: у юриста в папке окажется несколько
  // выгрузок за разные дни, и «consents.csv» трижды подряд их
  // перепутает.
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      // attachment, а не inline: браузер обязан сохранить файл, а не
      // показать 50 000 строк текстом во вкладке.
      'Content-Disposition': `attachment; filename="cookie-consents-${stamp}.csv"`,
      // Персональные данные не должны осесть в кэше браузера или
      // промежуточного прокси.
      'Cache-Control': 'no-store',
    },
  });
}
