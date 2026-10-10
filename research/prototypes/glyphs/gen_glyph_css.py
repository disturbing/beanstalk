"""Glyph option A (Seedling and leaf) as CSS masks, for three stylesheets. Writes between markers."""
import sys, re
from urllib.parse import quote

def svg(body):
    s = f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>{body}</svg>"
    return 'url("data:image/svg+xml,' + quote(s, safe="'=:/ ,.-") + '")'

W = "fill='%23fff'"
LEAF = svg("<path fill-rule='evenodd' fill='#fff' d='M12 15c1.2-5.6 5.2-8.6 10.4-8.2-.6 5.4-4.6 8.8-10.4 8.2ZM12.6 14.7 21.2 7.7l.3.4-8.6 7Z'/>")
SEEDLING = svg("<path fill='#fff' d='M12 14c-1-3.2-3.6-4.6-6-4.3.1 2.6 2.6 4.6 6 4.3ZM12 14c1-3.2 3.6-4.6 6-4.3-.1 2.6-2.6 4.6-6 4.3Z'/>")
FALLEN = svg("<path fill='none' stroke='#fff' stroke-width='1.3' d='M15 17c.4-3 2.6-4.8 5.6-4.6-.3 3-2.6 4.9-5.6 4.6Z' transform='rotate(35 18 15)'/>")
BEAN = svg("<path fill='#fff' d='M8.2 9.6c2.2-1.6 6.4-.6 7.3 2.2.9 2.8-1.6 4.9-4.4 4.6-2.8-.3-4.6-2.4-4.2-4.6.2-.9.6-1.7 1.3-2.2Z'/>")
BEAN_DASHED = svg("<path fill='none' stroke='#fff' stroke-width='1.5' stroke-dasharray='2 1.6' d='M8.2 9.6c2.2-1.6 6.4-.6 7.3 2.2.9 2.8-1.6 4.9-4.4 4.6-2.8-.3-4.6-2.4-4.2-4.6.2-.9.6-1.7 1.3-2.2Z'/>")
ORBIT = svg("<circle cx='12' cy='12' r='8.6' fill='none' stroke='#fff' stroke-width='1.7' stroke-dasharray='3 3.2' stroke-linecap='round'/>")
ARROW = svg("<path fill='none' stroke='#fff' stroke-width='1.8' stroke-linecap='round' d='M17.5 8.2C16.8 4.8 13.6 3 10.4 3.8 8.6 4.3 7.3 5.5 6.6 7'/><path fill='#fff' d='M4.6 5.2l2 3.6 2.9-2.4Z'/>")

def mask(url):
    return f"-webkit-mask: {url} center / 100% 100% no-repeat; mask: {url} center / 100% 100% no-repeat;"

def box(size):
    return f"position: absolute; left: 50%; right: auto; top: 50%; width: {size}px; height: {size}px; margin: -{size/2}px 0 0 -{size/2}px; border-radius: 0; box-shadow: none; transform: none;"

LEAF_BOX = box(30)
BEAN_BOX = box(27)

def css(d):
    """d: selector dialect"""
    g = d['glow']
    return f"""
/* glyphs:start (option A, Seedling and leaf; generated from prototypes/glyphs) */
{d['leaf']} {{ {LEAF_BOX} {mask(LEAF)} background: var(--leaf); filter: drop-shadow(0 0 3px var({g})); transform-origin: 50% 62%; transition: background 0.8s; animation: none; }}
{d['leafL']} {{ transform: scaleX(-1); }}
{d['sprout']} {{ {mask(SEEDLING)} background: var(--sprout); filter: drop-shadow(0 0 3px var({d['glowS']})); transform: none; }}
{d['red']} {{ background: var(--red); filter: drop-shadow(0 0 3px var({d['glowR']})); }}
{d['redX']} {{ content: ''; position: absolute; top: 50%; left: 50%; width: 8px; height: 8px; margin: -7.5px 0 0 4.6px; z-index: 2; background: linear-gradient(45deg, transparent 38%, var({d['bg']}) 38% 62%, transparent 62%), linear-gradient(-45deg, transparent 38%, var({d['bg']}) 38% 62%, transparent 62%); }}
{d['redXL']} {{ margin-left: -12.6px; }}
{d['fell']} {{ {LEAF_BOX} {mask(FALLEN)} background: var({d['fellc']}); }}
{d['bean']} {{ {BEAN_BOX} {mask(BEAN)} background: var(--bean); filter: drop-shadow(0 0 3px var({d['glowB']})); animation: none; }}
{d['queued']} {{ {mask(BEAN_DASHED)} background: var(--bean); filter: none; }}
{d['checking']} {{ {mask(BEAN)} background: var(--bean); box-shadow: none; transform: none; animation: none; }}
{d['checkingRing']} {{ content: ''; {BEAN_BOX} {mask(ORBIT)} background: var(--amber); }}
{d['rework']} {{ {mask(BEAN)} transform: none; background: var(--red); filter: drop-shadow(0 0 3px var({d['glowR']})); }}
{d['reworkArrow']} {{ content: ''; {BEAN_BOX} {mask(ARROW)} background: var(--red); }}
{d['enter']} {{ animation: glyph-grow 0.7s cubic-bezier(0.2, 1.5, 0.4, 1); }}
{d['matured']} {{ animation: glyph-mature 1.2s ease-out; }}
{d['bracket']} {{ display: grid; grid-template-columns: {d['cols']}; align-items: center; height: 20px; font: 600 10.5px var({d['mono']}); color: var(--leaf); }}
{d['bracketText']} {{ justify-self: start; border: 1px solid var(--leaf); border-radius: 4px; padding: 0 6px; margin-left: 4px; line-height: 16px; background: color-mix(in srgb, var(--leaf) 10%, transparent); }}
{d['bracketStem']} {{ position: relative; height: 100%; }}
{d['bracketStem']}::before {{ content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--leaf); }}
@media (prefers-reduced-motion: no-preference) {{
  {d['writing']} {{ animation: glyph-breathe 1.8s ease-in-out infinite; }}
  {d['checkingRing']} {{ animation: glyph-orbit 2.4s linear infinite; }}
  {d['rework']} {{ animation: glyph-nudge 1.6s ease-in-out infinite; }}
}}
@media (prefers-reduced-motion: reduce) {{
  {d['enter']}, {d['matured']} {{ animation: none; }}
}}
@keyframes glyph-breathe {{ 50% {{ transform: scale(0.8); opacity: 0.7; }} }}
@keyframes glyph-orbit {{ to {{ transform: rotate(360deg); }} }}
@keyframes glyph-nudge {{ 50% {{ translate: -1.5px 0; }} }}
@keyframes glyph-grow {{ from {{ scale: 0; }} to {{ scale: 1; }} }}
@keyframes glyph-mature {{ 0% {{ scale: 0.5; filter: brightness(2.6); }} 55% {{ scale: 1.2; }} 100% {{ scale: 1; }} }}
/* glyphs:end */
"""

PLAIN = dict(
    glow='--glowc', glowS='--glow-sprout', glowB='--glow-bean', glowR='--glow-red', bg='--bg', fellc='--fg-subtle', mono='--mono',
    leaf='.srow .lf', leafL='.srow.l .lf', sprout='.srow.sprout .lf, .srow.sprout.l .lf', red='.srow.red .lf',
    redX='.srow.red .stem::after', redXL='.srow.red.l .stem::after', fell='.srow.fell .fl',
    bean='.srow .beanmark', queued='.srow.queued .beanmark', checking='.srow.checking .beanmark',
    checkingRing='.srow.checking .stem::after', rework='.srow.reworking .beanmark', reworkArrow='.srow.reworking .stem::after',
    writing='.srow.writing .beanmark', enter='.srow.enter .lf, .srow.l.enter .lf', matured='.srow.matured .lf, .srow.promoted .lf',
    bracket='.matured-row', bracketText='.matured-row span:last-child', bracketStem='.matured-row .stem', cols='40px 28px minmax(0, 1fr)',
)
WEB = dict(
    glow='--glow', glowS='--glow-sprout', glowB='--glow-bean', glowR='--glow-red', bg='--sheet', fellc='--ink-3', mono='--font-mono',
    leaf='.srow .leaf', leafL=".srow[data-side='l'] .leaf", sprout=".srow[data-leaf='sprout'] .leaf", red=".srow[data-leaf='red'] .leaf",
    redX=".srow[data-leaf='red'] .stem::after", redXL=".srow[data-leaf='red'][data-side='l'] .stem::after", fell='.srow .fallen',
    bean='.srow .bud', queued=".srow[data-phase='pending'] .bud", checking=".srow[data-phase='checking'] .bud, .srow[data-phase='queued'] .bud, .srow[data-phase='testing'] .bud",
    checkingRing=".srow[data-phase='checking'] .stem::after, .srow[data-phase='queued'] .stem::after, .srow[data-phase='testing'] .stem::after",
    rework=".srow[data-phase='rework'] .bud", reworkArrow=".srow[data-phase='rework'] .stem::after",
    writing=".srow[data-phase='working'] .bud", enter='.enter .leaf', matured='.srow[data-matured] .leaf',
    bracket='.matured', bracketText='.matured span:last-child', bracketStem='.matured .stem', cols='40px 26px minmax(0, 1fr)',
)

def apply(path, dialect):
    s = open(path).read()
    s = re.sub(r"\n/\* glyphs:start.*?/\* glyphs:end \*/\n", "\n", s, flags=re.S)
    open(path, 'w').write(s.rstrip('\n') + '\n' + css(dialect))

if __name__ == '__main__':
    for arg in sys.argv[1:]:
        path, kind = arg.split('=')
        apply(path, WEB if kind == 'web' else PLAIN)
