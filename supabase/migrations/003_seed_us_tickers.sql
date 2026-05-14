-- Seed ~50 popular US tickers so they appear in the Add Transaction typeahead
-- without forcing users to enter them manually. Yahoo Finance uses the same
-- symbol for all of these, so refresh-prices can fetch them without a mapping.

insert into assets (ticker, name, type, sector, logo_bg, logo_text, logo_dark, is_cash) values
  -- Mega-cap tech
  ('AAPL',  'Apple Inc',                 'Stock', 'Tech',           '#000000', 'A',  false, false),
  ('MSFT',  'Microsoft Corp',            'Stock', 'Tech',           '#00a4ef', 'M',  false, false),
  ('NVDA',  'NVIDIA Corp',               'Stock', 'Tech',           '#76b900', 'N',  false, false),
  ('META',  'Meta Platforms',            'Stock', 'Tech',           '#1877f2', 'f',  false, false),
  ('TSLA',  'Tesla Inc',                 'Stock', 'Consumer',       '#cc0000', 'T',  false, false),
  ('NFLX',  'Netflix Inc',               'Stock', 'Communications', '#e50914', 'N',  false, false),
  ('AMD',   'Advanced Micro Devices',    'Stock', 'Tech',           '#ed1c24', 'A',  false, false),
  ('INTC',  'Intel Corp',                'Stock', 'Tech',           '#0071c5', 'i',  false, false),
  ('ORCL',  'Oracle Corp',               'Stock', 'Tech',           '#c74634', 'O',  false, false),
  ('CRM',   'Salesforce Inc',            'Stock', 'Tech',           '#00a1e0', 'sf', false, false),
  ('ADBE',  'Adobe Inc',                 'Stock', 'Tech',           '#fa0f00', 'A',  false, false),
  ('AVGO',  'Broadcom Inc',              'Stock', 'Tech',           '#cc092f', 'B',  false, false),
  -- Finance
  ('JPM',   'JPMorgan Chase',            'Stock', 'Finance',        '#1a4b8c', 'J',  false, false),
  ('BAC',   'Bank of America',           'Stock', 'Finance',        '#e31837', 'B',  false, false),
  ('WFC',   'Wells Fargo',               'Stock', 'Finance',        '#d71e28', 'W',  false, false),
  ('GS',    'Goldman Sachs',             'Stock', 'Finance',        '#7d9bbb', 'GS', false, false),
  ('MS',    'Morgan Stanley',            'Stock', 'Finance',        '#0067a0', 'MS', false, false),
  ('V',     'Visa Inc',                  'Stock', 'Finance',        '#1a1f71', 'V',  false, false),
  ('MA',    'Mastercard Inc',            'Stock', 'Finance',        '#eb001b', 'M',  false, false),
  ('AXP',   'American Express',          'Stock', 'Finance',        '#006fcf', 'A',  false, false),
  -- Consumer
  ('WMT',   'Walmart Inc',               'Stock', 'Consumer',       '#0071ce', 'W',  false, false),
  ('COST',  'Costco Wholesale',          'Stock', 'Consumer',       '#e31837', 'C',  false, false),
  ('HD',    'Home Depot',                'Stock', 'Consumer',       '#f96302', 'HD', false, false),
  ('NKE',   'Nike Inc',                  'Stock', 'Consumer',       '#000000', 'N',  false, false),
  ('MCD',   'McDonalds Corp',            'Stock', 'Consumer',       '#ffc72c', 'M',  true,  false),
  ('SBUX',  'Starbucks Corp',            'Stock', 'Consumer',       '#006241', 'S',  false, false),
  ('KO',    'Coca-Cola Co',              'Stock', 'Consumer',       '#f40009', 'KO', false, false),
  ('PEP',   'PepsiCo Inc',               'Stock', 'Consumer',       '#004b93', 'P',  false, false),
  ('DIS',   'Walt Disney Co',            'Stock', 'Consumer',       '#0a1f44', 'D',  false, false),
  -- Health
  ('JNJ',   'Johnson & Johnson',         'Stock', 'Healthcare',     '#cc0000', 'J',  false, false),
  ('UNH',   'UnitedHealth Group',        'Stock', 'Healthcare',     '#002677', 'U',  false, false),
  ('PFE',   'Pfizer Inc',                'Stock', 'Healthcare',     '#0093d0', 'P',  false, false),
  ('LLY',   'Eli Lilly & Co',            'Stock', 'Healthcare',     '#d52b1e', 'L',  false, false),
  ('ABBV',  'AbbVie Inc',                'Stock', 'Healthcare',     '#071d49', 'A',  false, false),
  ('MRK',   'Merck & Co',                'Stock', 'Healthcare',     '#00857c', 'M',  false, false),
  -- Industrials / Energy
  ('BA',    'Boeing Co',                 'Stock', 'Industrials',    '#0033a0', 'B',  false, false),
  ('CAT',   'Caterpillar Inc',           'Stock', 'Industrials',    '#ffcd11', 'CAT',true,  false),
  ('GE',    'General Electric',          'Stock', 'Industrials',    '#3873af', 'GE', false, false),
  ('XOM',   'Exxon Mobil',               'Stock', 'Energy',         '#ee1c25', 'E',  false, false),
  ('CVX',   'Chevron Corp',              'Stock', 'Energy',         '#0066b2', 'C',  false, false),
  -- Telecom / Media
  ('T',     'AT&T Inc',                  'Stock', 'Communications', '#00a8e0', 'T',  false, false),
  ('VZ',    'Verizon Communications',    'Stock', 'Communications', '#cd040b', 'V',  false, false),
  ('CMCSA', 'Comcast Corp',              'Stock', 'Communications', '#1c1c1c', 'C',  false, false),
  -- Diversified ETFs
  ('SPY',   'SPDR S&P 500 ETF',          'ETF',   'Diversified',    '#16519e', 'S',  false, false),
  ('QQQ',   'Invesco QQQ Trust',         'ETF',   'Diversified',    '#5a2d82', 'Q',  false, false),
  ('VTI',   'Vanguard Total Stock',      'ETF',   'Diversified',    '#9c1b1b', 'V',  false, false),
  ('IWM',   'iShares Russell 2000',      'ETF',   'Diversified',    '#000000', 'I',  false, false),
  ('DIA',   'SPDR Dow Jones ETF',        'ETF',   'Diversified',    '#16519e', 'D',  false, false),
  ('ARKK',  'ARK Innovation ETF',        'ETF',   'Diversified',    '#000000', 'ARK',false, false),
  -- REITs
  ('O',     'Realty Income Corp',        'Stock', 'REIT',           '#003865', 'O',  false, false),
  ('VNQ',   'Vanguard Real Estate ETF',  'ETF',   'REIT',           '#9c1b1b', 'V',  false, false)
on conflict (ticker) do nothing;
