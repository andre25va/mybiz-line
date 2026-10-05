import OpenAI from 'openai';
import { parseModelJson } from './lead';

const PROMPT = `You extract new clients from a text message or a screenshot that a business owner forwarded to his own CRM. The owner runs two businesses:
- myredeal: Andre Vargas Team real estate (buyers, sellers, realtors, investors, listings, budgets, neighborhoods)
- contractors-kc: Contractors of KC (concrete, remodel, renovation, countertops, decks)

Return only JSON:
{
  "needs_clarification": boolean,
  "question": string or null,
  "contacts": [
    {
      "name": string or null,
      "phone": string or null,
      "email": string or null,
      "client_type": string or null,
      "business": "myredeal" or "contractors-kc" or null,
      "location": string or null,
      "notes": string or null
    }
  ]
}

Rules:
- Never invent a name, phone, or email. Use null when it is not visible.
- If the client's name is missing or you are unsure who the client is, set needs_clarification to true, put a short question in question, and do not guess a name.
- If the message could belong to either business, set business to null and needs_clarification to true.
- Buyers, sellers, and real-estate budgets are myredeal. Concrete, remodel, countertops, and decks are contractors-kc.
- client_type is a short role such as buyer, seller, realtor, investor, vendor, countertop, remodel, or concrete. Use null if it is not stated.
- Put budget, timing, and other facts in notes. Summarize long emails instead of copying them.
- Never use these phone numbers as the client's phone: {{blocked}}
- A pasted lead, email, or form is one client unless several different people are clearly listed.
- If the message is not about a client, set needs_clarification to false and contacts to [].`;

export async function extractLead(input: { text: string; images: { base64: string; mime: string }[] }): Promise<unknown> {
  const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
  const hasImages = input.images.length > 0;
  const textModel = process.env.INTAKE_TEXT_MODEL || (provider === 'openai' ? 'gpt-4o-mini' : '');
  const visionModel = process.env.INTAKE_VISION_MODEL || (provider === 'openai' ? 'gpt-4o' : '');
  const model = hasImages ? visionModel : textModel;
  if (!model) throw new Error('Intake model is not configured. Set INTAKE_TEXT_MODEL and INTAKE_VISION_MODEL.');

  let apiKey = process.env.OPENAI_API_KEY;
  let baseURL = process.env.OPENAI_BASE_URL || undefined;
  if (provider === 'grok' || provider === 'xai') {
    apiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
    baseURL = process.env.OPENAI_BASE_URL || 'https://api.x.ai/v1';
  }
  if (!apiKey) throw new Error('Missing AI API key');

  const blocked = [process.env.CLIENT_INTAKE_ALLOWLIST, process.env.TWILIO_PHONE_NUMBER, '+13129989898', '+14647333257']
    .filter(Boolean)
    .join(', ');
  const openai = new OpenAI({ apiKey, baseURL });
  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: 'text', text: input.text || 'Extract the client from the attached image.' },
  ];
  for (const image of input.images.slice(0, 3)) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${image.mime};base64,${image.base64}` },
    });
  }

  const completion = await openai.chat.completions.create({
    model,
    ...(provider === 'openai' ? { response_format: { type: 'json_object' as const } } : {}),
    messages: [
      { role: 'system', content: PROMPT.replace('{{blocked}}', blocked) },
      { role: 'user', content: hasImages ? userContent : input.text || 'Extract the client.' },
    ],
    max_tokens: 800,
  });
  return parseModelJson(completion.choices[0]?.message?.content || '{}');
}
