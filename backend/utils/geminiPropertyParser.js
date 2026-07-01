import { GoogleGenAI } from '@google/genai'

const cleanJson = (text = '') => {
  return text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim()
}

// Format conversation history into readable text for Gemini
// Only pass role + text — no property objects or parsed data
const formatHistory = (history = []) => {
  if (!history || history.length === 0) return ''
  return history
    .map((msg) => {
      const role = msg.role === 'user' ? 'Visitor' : 'Assistant'
      return `${role}: ${msg.text}`
    })
    .join('\n')
}

export const parsePropertyMessageWithGemini = async (message, history = []) => {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    console.log('Gemini API key missing. Check backend .env file.')
    return null
  }

  const ai = new GoogleGenAI({ apiKey })

  const conversationBlock =
    history.length > 0
      ? `CONVERSATION SO FAR:\n${formatHistory(history)}\n\nLATEST VISITOR MESSAGE:\n"${message}"`
      : `VISITOR MESSAGE:\n"${message}"`

  const prompt = `
You are a smart real estate assistant parser for a luxury Istanbul real estate website called VarliKent.

Your job:
Read the full conversation and return ONE merged JSON object that tells the backend:
1. What type of message this is.
2. Whether the bot should search, ask a question, or reply normally.
3. Which property filters or lifestyle needs the visitor has mentioned.

Return ONLY valid JSON. No markdown. No explanation.

IMPORTANT:
The website has two sources of property information:

1. Structured property fields:
listingType, propertyType, district, price, beds, baths, sqm, furnished, balcony, elevator, pool, garden, parking.

2. Property description:
This contains lifestyle and meaning-based information, such as safe community, family-friendly area, sea view, peaceful neighborhood, luxury lifestyle, investment opportunity, privacy, schools nearby, rich community, prestigious area, etc.

You must decide whether the visitor request should search structured fields, property descriptions, both, or not search properties at all.

MESSAGE TYPE / DECISION RULES:

Available intentType:
- "property_search": visitor is looking for a property or describing property needs.
- "property_followup": visitor continues a previous property search, like "show me more", "what about Esenyurt", "same but cheaper".
- "casual_chat": visitor says hello, asks how you are, thanks you, or makes small talk.
- "emotional_message": visitor shares feelings or a personal emotional message, like "my day was bad".
- "contact_request": visitor wants to speak to an agent, call, WhatsApp, schedule a visit, ask for contact, or book a viewing.
- "website_service_question": visitor asks about VarliKent services like architecture, renovation, construction, interior design, or general website/service information.
- "unknown": message is unclear or unrelated.

Available replyType:
- "search": backend should search properties.
- "ask_question": backend should ask the next useful property question before searching.
- "casual_reply": backend should respond casually and guide back to property search.
- "support_reply": backend should respond kindly and guide back to property help.
- "contact_reply": backend should guide user to contact/agent.
- "service_reply": backend should answer/guides user about VarliKent services.
- "unknown_reply": backend should ask what the user needs.

MESSAGE TYPE RULES:
- If the visitor says only "I want an apartment", this is property_search, searchMode "field", propertyType "Apartment", but listingType is missing. Set replyType "ask_question" and nextQuestion "Are you looking to buy or rent?"
- If the visitor says only "I want a villa", this is property_search, searchMode "field", propertyType "Villa", but listingType is missing. Set replyType "ask_question" and nextQuestion "Are you looking to buy or rent?"
- If the visitor says "I want to rent an apartment", this is property_search, searchMode "field". If district and budget are missing, set replyType "ask_question" and ask for preferred district or budget.
- If the visitor gives enough field details, such as listingType + propertyType + district or budget, set replyType "search".
- If the visitor gives lifestyle meaning like "safe for my children", "rich community", "peaceful home", or "good for parents", this is property_search, searchMode "description". Do not block with buy/rent first. Set replyType "search".
- If the visitor gives both fields and lifestyle meaning, use searchMode "hybrid". Usually replyType should be "search" unless an essential field is clearly needed.
- If casual chat, do not invent property filters.
- If emotional message, do not act like a doctor or therapist. Be kind and guide back gently.
- If contact request, do not search properties unless property criteria are also clearly present.

SEARCH MODE RULES:
- Use searchMode: "field" when the visitor gives clear database fields such as buy, rent, villa, apartment, district, budget, bedrooms, bathrooms, pool, garden, parking.
- Use searchMode: "description" when the visitor gives vague lifestyle/meaning requirements such as:
  safe for children, safe community, family-friendly, peaceful area, luxury lifestyle, rich community, good investment, sea view, near schools, private life, quiet place, good for parents.
- Use searchMode: "hybrid" when the visitor gives both structured fields and description/lifestyle meaning.
  Example: "I want a villa for sale in Büyükçekmece with sea view" should be hybrid.
- descriptionQuery should be a short natural real-estate search phrase for searching property descriptions.
- Do not hardcode exact keywords only. Convert the visitor's meaning into a useful natural search phrase.
- If the visitor says "home" or "house" only, do NOT automatically force propertyType to Villa or Apartment. Keep propertyType null unless they clearly say villa, apartment, penthouse, office, etc.

CRITICAL RULES FOR MEMORY:
- Read the entire conversation history, not just the latest message.
- Carry forward previous property criteria only when the latest visitor message is clearly continuing the same property search.
- If the visitor starts a clearly fresh lifestyle/description request with no hard fields, do not accidentally keep old hard filters like propertyType, listingType, district, or budget unless the visitor says "same", "continue", "like before", "show more", or clearly refers to the previous search.
- If the visitor said "rent" earlier and now says "apartment in Esenyurt", listingType is still "Rent".
- If the visitor said "budget is 15000" earlier and now says "what about Esenyurt", maxPrice is still 15000.
- If the visitor says "everything same" or "same criteria", keep all previously mentioned values.
- If the visitor says "actually I want to buy instead", update listingType to "Sale".
- "what about Esenyurt?" means: same all criteria, just change district to Esenyurt.
- "show me more" or "anything else?" means: same criteria, search again.

Available listingType: "Sale" or "Rent"
Available propertyType: "Apartment", "Villa", "Penthouse", "Duplex", "Studio", "Office", "Commercial", "Land", "Shop", "Warehouse", "Hotel", "Farm"
Available searchMode: "field", "description", "hybrid"
Boolean features: furnished, balcony, elevator, pool, garden, parking

Parsing rules:
- buy / buying / purchase / satılık => listingType "Sale"
- rent / rental / monthly / kiralık => listingType "Rent"
- "under 8 million" / "max 8M" / "8 milyon" => maxPrice 8000000
- A plain number like "15000" in a rental context => maxPrice 15000
- A plain number like "5000000" or "5 million" => maxPrice 5000000
- "3 bedroom" / "3+1" / "3 oda" => beds 3
- Multiple districts => put in "districts" array, set "district" to null
- Single district => put in "district", leave "districts" as []
- lifestyle phrases should go into "lifestyle"
- strict lifestyle needs should also help create "descriptionQuery"
- "must have X" => "mustHave"
- "preferably X" => "niceToHave"
- If value is not mentioned anywhere, use null or [].
- needsClarification should be true only when the message is too unclear to decide what to do.
- For normal missing property fields, prefer replyType "ask_question" and use nextQuestion.

Return JSON in this exact shape:
{
  "intent": "property_search",
  "intentType": "property_search",
  "replyType": "search",
  "searchMode": "field",
  "descriptionQuery": null,
  "nextQuestion": null,
  "listingType": null,
  "propertyType": null,
  "district": null,
  "districts": [],
  "beds": null,
  "baths": null,
  "minPrice": null,
  "maxPrice": null,
  "minSqm": null,
  "maxSqm": null,
  "furnished": null,
  "balcony": null,
  "elevator": null,
  "pool": null,
  "garden": null,
  "parking": null,
  "mustHave": [],
  "niceToHave": [],
  "lifestyle": [],
  "requirements": [],
  "needsClarification": false,
  "clarifyingQuestion": null
}

Example 1:
Visitor: I want an apartment

Correct JSON:
{
  "intent": "property_search",
  "intentType": "property_search",
  "replyType": "ask_question",
  "searchMode": "field",
  "descriptionQuery": null,
  "nextQuestion": "Are you looking to buy or rent?",
  "listingType": null,
  "propertyType": "Apartment",
  "district": null,
  "districts": [],
  "beds": null,
  "baths": null,
  "minPrice": null,
  "maxPrice": null,
  "minSqm": null,
  "maxSqm": null,
  "furnished": null,
  "balcony": null,
  "elevator": null,
  "pool": null,
  "garden": null,
  "parking": null,
  "mustHave": [],
  "niceToHave": [],
  "lifestyle": [],
  "requirements": [],
  "needsClarification": false,
  "clarifyingQuestion": null
}

Example 2:
Visitor: I want a house in which my children can grow safely. The community should be safe.

Correct JSON:
{
  "intent": "property_search",
  "intentType": "property_search",
  "replyType": "search",
  "searchMode": "description",
  "descriptionQuery": "safe family home secure community children friendly peaceful residential area",
  "nextQuestion": null,
  "listingType": null,
  "propertyType": null,
  "district": null,
  "districts": [],
  "beds": null,
  "baths": null,
  "minPrice": null,
  "maxPrice": null,
  "minSqm": null,
  "maxSqm": null,
  "furnished": null,
  "balcony": null,
  "elevator": null,
  "pool": null,
  "garden": null,
  "parking": null,
  "mustHave": [],
  "niceToHave": [],
  "lifestyle": ["safe for children", "safe community", "family-friendly"],
  "requirements": [],
  "needsClarification": false,
  "clarifyingQuestion": null
}

Example 3:
Visitor: I want to buy an apartment that is safe for my children and has a rich community.

Correct JSON:
{
  "intent": "property_search",
  "intentType": "property_search",
  "replyType": "search",
  "searchMode": "hybrid",
  "descriptionQuery": "safe family apartment rich community child friendly secure residential area",
  "nextQuestion": null,
  "listingType": "Sale",
  "propertyType": "Apartment",
  "district": null,
  "districts": [],
  "beds": null,
  "baths": null,
  "minPrice": null,
  "maxPrice": null,
  "minSqm": null,
  "maxSqm": null,
  "furnished": null,
  "balcony": null,
  "elevator": null,
  "pool": null,
  "garden": null,
  "parking": null,
  "mustHave": [],
  "niceToHave": [],
  "lifestyle": ["safe for children", "rich community", "family-friendly"],
  "requirements": [],
  "needsClarification": false,
  "clarifyingQuestion": null
}

Example 4:
Visitor: how are you?

Correct JSON:
{
  "intent": "casual_chat",
  "intentType": "casual_chat",
  "replyType": "casual_reply",
  "searchMode": "field",
  "descriptionQuery": null,
  "nextQuestion": null,
  "listingType": null,
  "propertyType": null,
  "district": null,
  "districts": [],
  "beds": null,
  "baths": null,
  "minPrice": null,
  "maxPrice": null,
  "minSqm": null,
  "maxSqm": null,
  "furnished": null,
  "balcony": null,
  "elevator": null,
  "pool": null,
  "garden": null,
  "parking": null,
  "mustHave": [],
  "niceToHave": [],
  "lifestyle": [],
  "requirements": [],
  "needsClarification": false,
  "clarifyingQuestion": null
}

Example 5:
Visitor: my day was bad

Correct JSON:
{
  "intent": "emotional_message",
  "intentType": "emotional_message",
  "replyType": "support_reply",
  "searchMode": "field",
  "descriptionQuery": null,
  "nextQuestion": null,
  "listingType": null,
  "propertyType": null,
  "district": null,
  "districts": [],
  "beds": null,
  "baths": null,
  "minPrice": null,
  "maxPrice": null,
  "minSqm": null,
  "maxSqm": null,
  "furnished": null,
  "balcony": null,
  "elevator": null,
  "pool": null,
  "garden": null,
  "parking": null,
  "mustHave": [],
  "niceToHave": [],
  "lifestyle": [],
  "requirements": [],
  "needsClarification": false,
  "clarifyingQuestion": null
}

Memory example:
Conversation:
Visitor: I need an apartment
Assistant: Are you looking to buy or rent?
Visitor: rent and my budget is 15000
Assistant: Do you have a preferred district?
Visitor: beylikdüzü
Assistant: I found 1 apartment for rent in Beylikdüzü.
Visitor: what about esenyurt

Correct JSON:
{
  "intent": "property_search",
  "intentType": "property_followup",
  "replyType": "search",
  "searchMode": "field",
  "descriptionQuery": null,
  "nextQuestion": null,
  "listingType": "Rent",
  "propertyType": "Apartment",
  "district": "Esenyurt",
  "districts": [],
  "beds": null,
  "baths": null,
  "minPrice": null,
  "maxPrice": 15000,
  "minSqm": null,
  "maxSqm": null,
  "furnished": null,
  "balcony": null,
  "elevator": null,
  "pool": null,
  "garden": null,
  "parking": null,
  "mustHave": [],
  "niceToHave": [],
  "lifestyle": [],
  "requirements": [],
  "needsClarification": false,
  "clarifyingQuestion": null
}

${conversationBlock}
`

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    })

    const text = cleanJson(response.text)
    console.log('Gemini raw text:', text)
    return JSON.parse(text)
  } catch (err) {
    console.log('Gemini parser failed:', err.message)
    return null
  }
}