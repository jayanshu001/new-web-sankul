# terms — API reference

> Auto-generated from a passing `migration:api` run for **terms**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 6

---

## GET /api/v1/admin/cms/terms

### Request headers
```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <token>"
}
```

### Response (`200`)
```json
{
  "success": true,
  "data": [
    {
      "_id": "1",
      "module": "book",
      "terms": "તમે ઓર્ડર કરાવેલી બુક 3 થી 5 કામકાજ ના દિવસ માં તમારા આપેલા સરનામાં પર મળવા પાત્ર રહેશે.\\nજો અનાવશ્યક સંજોગો માં પુસ્તક મળવામાં વિલંબ થાય તો સહકાર આપવા વિનંતી. \\nઆપણી કુરિયર સેવા દ્વારા ગામડાંના વિસ્તારમાં પુસ્તક પહોંચી શકશે નહિ. \\nજો તમે ગામડામાં રહો છો તો તમારે તમારી નજીકના તાલુકાનું કોઈ પણ સરનામું લખવું અથવા તમારે તાલુકાની તિરુપતિ કુરિયર સર્વિસની ઓફિસ પરથી કુરિયર મેળવી લેવાનું રહેશે. \\nઓનલાઈન ઓર્ડર કર્યા બાદ કોઈ પણ સંજોગોમાં ઓર્ડર કેન્સલ થશે નહિ. \\nએક વાર payment successful થયા પછી refund મળી શકશે નહિ .\\nગુજરાત ની બહાર બુક મેળવા માટે વધારાનો ચાર્જ આપવાનો રહેશે. \\nજો પુસ્તક ખામી યુક્ત અથવા મંગાવેલ પુસ્તક ના સ્થાને અન્ય કોઈ પુસ્તક મળે તો 3 દિવસ માં પાછા મોકલાવી દેવું ત્યાર બાદ સંસ્થા ની જવાબદારી રહેશે નહિ.\\n book helpline number : +91 77779 91348",
      "freeShippingMinimumOrderAmount": 500,
      "status": true
    },
    {
      "_id": "2",
      "module": "pendrive",
      "terms": " વેબસંકુલ પેનડ્રાઈવ કોર્સ એક જ  ડિવાઇઝ સાથે રજીસ્ટર થઈ શકશે.\\n કોઈ પણ સંજોગોમાં લેપટોપ,કોમ્પ્યુટર ખરાબ થઈ જશે તો પેનડ્રાઇવ અન્ય ડિવાઇઝમાં  બદલી શકાશે નહીં.\\n ઓપરેટિંગ સિસ્ટમ અપડેટ, System Format, System Crash બાદ ફરીથી રજીસ્ટ્રેશન થઈ શકશે નહીં.\\n કોઈ પણ કારણોસર ડિવાઇઝ બદલાવવાની જરૂર પડે છે તો Device Transfer Charge – 1000/- અલગથી ચુકવવાના રહેશે.\\n એક વખત ઓર્ડર કર્યા બાદ GPSC કોર્સમાંથી Class – 3 કે Class – 3 કોર્સમાંથી GPSC ના કોર્સમાં બદલી શકાશે નહીં.\\n એક વાર પેનડ્રાઈવ ઓર્ડર થયા બાદ ભવિષ્યમાં તેમાં રહેલા વિડિયો લેકચર કે મટીરિયલમાં નવો ઉમેરો કે અપડેટ થશે નહીં.\\n આપને મળેલ પેનડ્રાઈવ સાચવવાની જવાબદારી તમારી પોતાની રહેશે, જો તે ખોવાઈ જાય, તૂટી જાય કે કોઈ અન્ય કારણોસર બગડી જાય તો તેની જવાબદારી સંસ્થાની રહેશે નહીં.\\n પેનડ્રાઇવ Android TV, Projector, Large Display કે અન્ય ક્લોનીંગ ડિવાઇઝમાં ચાલશે નહીં .\\n પેનડ્રાઈવને Android ટીવી, Projector, Screen Sharing, Mirror Casting, Screen Recording, Application Cloning કે અન્ય કોઈ પણ રીતે છેડછાડ કરવી એ ફોજદારી ગુનો બને છે અને સંસ્થાના ધ્યાને આવતા કાયદેસરની કાર્યવાહી કરવામાં આવશે.",
      "freeShippingMinimumOrderAmount": 0,
      "status": true
    }
  ],
  "_note": "array truncated for docs — 3 items total; first 2 shown"
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/admin/cms/terms/:id

### Request headers
```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <token>"
}
```

### Response (`200`)
```json
{
  "success": true,
  "data": {
    "_id": "1",
    "module": "book",
    "terms": "તમે ઓર્ડર કરાવેલી બુક 3 થી 5 કામકાજ ના દિવસ માં તમારા આપેલા સરનામાં પર મળવા પાત્ર રહેશે.\\nજો અનાવશ્યક સંજોગો માં પુસ્તક મળવામાં વિલંબ થાય તો સહકાર આપવા વિનંતી. \\nઆપણી કુરિયર સેવા દ્વારા ગામડાંના વિસ્તારમાં પુસ્તક પહોંચી શકશે નહિ. \\nજો તમે ગામડામાં રહો છો તો તમારે તમારી નજીકના તાલુકાનું કોઈ પણ સરનામું લખવું અથવા તમારે તાલુકાની તિરુપતિ કુરિયર સર્વિસની ઓફિસ પરથી કુરિયર મેળવી લેવાનું રહેશે. \\nઓનલાઈન ઓર્ડર કર્યા બાદ કોઈ પણ સંજોગોમાં ઓર્ડર કેન્સલ થશે નહિ. \\nએક વાર payment successful થયા પછી refund મળી શકશે નહિ .\\nગુજરાત ની બહાર બુક મેળવા માટે વધારાનો ચાર્જ આપવાનો રહેશે. \\nજો પુસ્તક ખામી યુક્ત અથવા મંગાવેલ પુસ્તક ના સ્થાને અન્ય કોઈ પુસ્તક મળે તો 3 દિવસ માં પાછા મોકલાવી દેવું ત્યાર બાદ સંસ્થા ની જવાબદારી રહેશે નહિ.\\n book helpline number : +91 77779 91348",
    "freeShippingMinimumOrderAmount": 500,
    "status": true
  }
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## POST /api/v1/admin/cms/terms

### Request headers
```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <token>",
  "Content-Type": "application/json"
}
```

### Request body
```json
{
  "module": "book",
  "terms": "before",
  "freeShippingMinimumOrderAmount": 250,
  "status": true
}
```

### Response (`201`)
```json
{
  "success": true,
  "data": {
    "_id": "48",
    "module": "book",
    "terms": "before",
    "freeShippingMinimumOrderAmount": 250,
    "status": true
  }
}
```

_(3 calls captured for this endpoint; first shown.)_

---

## PUT /api/v1/admin/cms/terms/:id

### Request headers
```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <token>",
  "Content-Type": "application/json"
}
```

### Request body
```json
{
  "terms": "after",
  "freeShippingMinimumOrderAmount": 0,
  "status": false
}
```

### Response (`200`)
```json
{
  "success": true,
  "data": {
    "_id": "48",
    "module": "book",
    "terms": "after",
    "freeShippingMinimumOrderAmount": 0,
    "status": false
  }
}
```

---

## DELETE /api/v1/admin/cms/terms/:id

### Request headers
```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <token>"
}
```

### Response (`200`)
```json
{
  "success": true,
  "message": "Deleted."
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/client/terms

### Request headers
```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <token>"
}
```

### Response (`200`)
```json
{
  "success": true,
  "data": [
    {
      "_id": "1",
      "module": "book",
      "terms": "તમે ઓર્ડર કરાવેલી બુક 3 થી 5 કામકાજ ના દિવસ માં તમારા આપેલા સરનામાં પર મળવા પાત્ર રહેશે.\\nજો અનાવશ્યક સંજોગો માં પુસ્તક મળવામાં વિલંબ થાય તો સહકાર આપવા વિનંતી. \\nઆપણી કુરિયર સેવા દ્વારા ગામડાંના વિસ્તારમાં પુસ્તક પહોંચી શકશે નહિ. \\nજો તમે ગામડામાં રહો છો તો તમારે તમારી નજીકના તાલુકાનું કોઈ પણ સરનામું લખવું અથવા તમારે તાલુકાની તિરુપતિ કુરિયર સર્વિસની ઓફિસ પરથી કુરિયર મેળવી લેવાનું રહેશે. \\nઓનલાઈન ઓર્ડર કર્યા બાદ કોઈ પણ સંજોગોમાં ઓર્ડર કેન્સલ થશે નહિ. \\nએક વાર payment successful થયા પછી refund મળી શકશે નહિ .\\nગુજરાત ની બહાર બુક મેળવા માટે વધારાનો ચાર્જ આપવાનો રહેશે. \\nજો પુસ્તક ખામી યુક્ત અથવા મંગાવેલ પુસ્તક ના સ્થાને અન્ય કોઈ પુસ્તક મળે તો 3 દિવસ માં પાછા મોકલાવી દેવું ત્યાર બાદ સંસ્થા ની જવાબદારી રહેશે નહિ.\\n book helpline number : +91 77779 91348",
      "freeShippingMinimumOrderAmount": 500,
      "status": true
    },
    {
      "_id": "2",
      "module": "pendrive",
      "terms": " વેબસંકુલ પેનડ્રાઈવ કોર્સ એક જ  ડિવાઇઝ સાથે રજીસ્ટર થઈ શકશે.\\n કોઈ પણ સંજોગોમાં લેપટોપ,કોમ્પ્યુટર ખરાબ થઈ જશે તો પેનડ્રાઇવ અન્ય ડિવાઇઝમાં  બદલી શકાશે નહીં.\\n ઓપરેટિંગ સિસ્ટમ અપડેટ, System Format, System Crash બાદ ફરીથી રજીસ્ટ્રેશન થઈ શકશે નહીં.\\n કોઈ પણ કારણોસર ડિવાઇઝ બદલાવવાની જરૂર પડે છે તો Device Transfer Charge – 1000/- અલગથી ચુકવવાના રહેશે.\\n એક વખત ઓર્ડર કર્યા બાદ GPSC કોર્સમાંથી Class – 3 કે Class – 3 કોર્સમાંથી GPSC ના કોર્સમાં બદલી શકાશે નહીં.\\n એક વાર પેનડ્રાઈવ ઓર્ડર થયા બાદ ભવિષ્યમાં તેમાં રહેલા વિડિયો લેકચર કે મટીરિયલમાં નવો ઉમેરો કે અપડેટ થશે નહીં.\\n આપને મળેલ પેનડ્રાઈવ સાચવવાની જવાબદારી તમારી પોતાની રહેશે, જો તે ખોવાઈ જાય, તૂટી જાય કે કોઈ અન્ય કારણોસર બગડી જાય તો તેની જવાબદારી સંસ્થાની રહેશે નહીં.\\n પેનડ્રાઇવ Android TV, Projector, Large Display કે અન્ય ક્લોનીંગ ડિવાઇઝમાં ચાલશે નહીં .\\n પેનડ્રાઈવને Android ટીવી, Projector, Screen Sharing, Mirror Casting, Screen Recording, Application Cloning કે અન્ય કોઈ પણ રીતે છેડછાડ કરવી એ ફોજદારી ગુનો બને છે અને સંસ્થાના ધ્યાને આવતા કાયદેસરની કાર્યવાહી કરવામાં આવશે.",
      "freeShippingMinimumOrderAmount": 0,
      "status": true
    }
  ],
  "_note": "array truncated for docs — 3 items total; first 2 shown"
}
```

_(5 calls captured for this endpoint; first shown.)_

---
