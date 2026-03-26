import { emailLayout, ctaButton } from './layout'
import { getBaseUrl } from '@/lib/email/service'

function drip(userId: string, body: string): string {
  return emailLayout({ userId, body })
}

const base = () => getBaseUrl()

export function dripStep1(opts: { name: string; userId: string }): string {
  const firstName = opts.name.split(' ')[0] || 'there'
  return drip(opts.userId, `
    <p style="margin:0 0 16px 0;font-size:16px;">Hi ${firstName},</p>
    <p style="margin:0 0 16px 0;color:#444444;">Ready to write your first paper? It takes about 3 minutes.</p>
    <p style="margin:0 0 8px 0;font-weight:500;">Here's how:</p>
    <ol style="margin:0 0 16px 0;padding-left:20px;color:#444444;">
      <li style="margin-bottom:6px;">Click "New Project" and type your topic</li>
      <li style="margin-bottom:6px;">Choose your paper type (literature review, research article, etc.)</li>
      <li style="margin-bottom:6px;">Hit Generate — GenPaper finds sources and writes every section</li>
    </ol>
    <p style="margin:0 0 16px 0;color:#444444;">You can also upload your own PDFs as sources, or write from scratch in the editor.</p>
    ${ctaButton('Create a Project', `${base()}/projects`)}
  `)
}

export function dripStep2(opts: { name: string; userId: string }): string {
  const firstName = opts.name.split(' ')[0] || 'there'
  return drip(opts.userId, `
    <p style="margin:0 0 16px 0;font-size:16px;">Hi ${firstName},</p>
    <p style="margin:0 0 16px 0;color:#444444;">Did you know GenPaper has a built-in research library?</p>
    <p style="margin:0 0 8px 0;font-weight:500;">Your library lets you:</p>
    <ul style="margin:0 0 16px 0;padding-left:20px;color:#444444;">
      <li style="margin-bottom:6px;">Upload PDFs of papers you already have</li>
      <li style="margin-bottom:6px;">Search millions of real academic publications</li>
      <li style="margin-bottom:6px;">Save papers for later and use them as sources</li>
      <li style="margin-bottom:6px;">Select specific papers when creating a new project</li>
    </ul>
    ${ctaButton('Explore Your Library', `${base()}/library`)}
  `)
}

export function dripStep3(opts: { name: string; userId: string }): string {
  const firstName = opts.name.split(' ')[0] || 'there'
  return drip(opts.userId, `
    <p style="margin:0 0 16px 0;font-size:16px;">Hi ${firstName},</p>
    <p style="margin:0 0 16px 0;color:#444444;">Every project in GenPaper comes with an AI chat assistant in the editor sidebar.</p>
    <p style="margin:0 0 8px 0;font-weight:500;">You can ask it things like:</p>
    <ul style="margin:0 0 16px 0;padding-left:20px;color:#444444;font-style:italic;">
      <li style="margin-bottom:6px;">"Summarize the methodology section"</li>
      <li style="margin-bottom:6px;">"What are the key findings from my sources?"</li>
      <li style="margin-bottom:6px;">"Help me strengthen my argument in paragraph 3"</li>
      <li style="margin-bottom:6px;">"Suggest a better transition here"</li>
    </ul>
    <p style="margin:0 0 16px 0;color:#444444;">It knows your paper and your sources, so the answers are always relevant.</p>
    ${ctaButton('Try AI Chat', `${base()}/projects`)}
  `)
}

export function dripStep4(opts: { name: string; userId: string }): string {
  const firstName = opts.name.split(' ')[0] || 'there'
  return drip(opts.userId, `
    <p style="margin:0 0 16px 0;font-size:16px;">Hi ${firstName},</p>
    <p style="margin:0 0 16px 0;color:#444444;">GenPaper handles citations automatically — every source is real and properly formatted.</p>
    <p style="margin:0 0 8px 0;font-weight:500;">Citation features:</p>
    <ul style="margin:0 0 16px 0;padding-left:20px;color:#444444;">
      <li style="margin-bottom:6px;"><strong>APA, MLA, Chicago</strong> — switch styles with one click</li>
      <li style="margin-bottom:6px;"><strong>In-text citations</strong> — automatically placed where relevant</li>
      <li style="margin-bottom:6px;"><strong>Bibliography</strong> — generated and formatted for you</li>
    </ul>
    <p style="margin:0 0 16px 0;color:#444444;">When you're done, export to <strong>Word, PDF, or LaTeX</strong> — ready to submit.</p>
    ${ctaButton('Open the Editor', `${base()}/projects`)}
  `)
}

export function dripStep5(opts: { name: string; userId: string }): string {
  const firstName = opts.name.split(' ')[0] || 'there'
  return drip(opts.userId, `
    <p style="margin:0 0 16px 0;font-size:16px;">Hi ${firstName},</p>
    <p style="margin:0 0 16px 0;color:#444444;">Here are a few tips to get even more from GenPaper:</p>
    <ol style="margin:0 0 16px 0;padding-left:20px;color:#444444;">
      <li style="margin-bottom:8px;"><strong>Write Mode</strong> — Want to write yourself? Choose "Write" instead of "Generate" when creating a project. You get AI autocomplete as you type.</li>
      <li style="margin-bottom:8px;"><strong>Be specific with topics</strong> — "Impact of social media on teen mental health in 2020-2024" works better than "social media effects."</li>
      <li style="margin-bottom:8px;"><strong>Upload your own sources</strong> — Drop PDFs into your library, then select them when creating a project.</li>
      <li style="margin-bottom:8px;"><strong>Regenerate</strong> — Not happy with a section? You can always regenerate from the editor.</li>
      <li style="margin-bottom:8px;"><strong>Version history</strong> — Every edit is saved. Go back to any version anytime.</li>
    </ol>
    ${ctaButton('Start Writing', `${base()}/projects`)}
  `)
}

export function dripStep6(opts: { name: string; userId: string }): string {
  const firstName = opts.name.split(' ')[0] || 'there'
  return drip(opts.userId, `
    <p style="margin:0 0 16px 0;font-size:16px;">Hi ${firstName},</p>
    <p style="margin:0 0 16px 0;color:#444444;">You've been using GenPaper — nice! If you're finding it useful, here's what our paid plans unlock:</p>
    <div style="background:#fafafa;padding:16px;border-radius:6px;border:1px solid #e5e5e5;margin:16px 0;">
      <p style="margin:0 0 8px 0;font-weight:600;">Starter ($13/mo)</p>
      <ul style="margin:0;padding-left:20px;color:#444444;font-size:14px;">
        <li>5 papers per month</li>
        <li>All paper types</li>
        <li>Full references visible</li>
        <li>Unlimited autocomplete</li>
      </ul>
    </div>
    <div style="background:#fafafa;padding:16px;border-radius:6px;border:1px solid #e5e5e5;margin:16px 0;">
      <p style="margin:0 0 8px 0;font-weight:600;">Pro ($33/mo)</p>
      <ul style="margin:0;padding-left:20px;color:#444444;font-size:14px;">
        <li>15 papers per month</li>
        <li>Thesis & dissertation support</li>
        <li>PDF export</li>
        <li>Priority generation</li>
      </ul>
    </div>
    ${ctaButton('View Plans', `${base()}/pricing`)}
    <p style="margin:16px 0 0 0;color:#999999;font-size:13px;">No pressure — the free plan is always available.</p>
  `)
}
