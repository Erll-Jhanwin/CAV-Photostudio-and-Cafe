"""Shared, approved public knowledge used by the chatbot.

Keeping the built-in FAQs in a small standalone module prevents the retrieval
layer and the API view from maintaining different copies of the same facts.
Database-managed FAQs are still supported and take precedence when their
question matches a built-in entry.
"""

STUDIO_ADDRESS = '028B M.P. Casanova St., Purok 1, Tambo, Lipa City, Batangas.'

DEFAULT_FAQS = [
    {
        'id': 1,
        'question': 'What are your operating hours?',
        'answer': 'CAV Photo Studio and Cafe is open daily from 9:00 AM to 7:00 PM Philippine time (Asia/Manila, UTC+8).',
        'answer_tl': 'Bukas ang CAV Photo Studio and Cafe araw-araw mula 9:00 AM hanggang 7:00 PM Philippine time (Asia/Manila, UTC+8).',
        'tags': 'hours,schedule,open,opening',
    },
    {
        'id': 2,
        'question': 'How do I book a studio session?',
        'answer': 'Log in, open Book Session, choose a package, select an available date and time, then submit your booking.',
        'answer_tl': 'Mag-log in, buksan ang Book Session, piliin ang package, pumili ng available na petsa at oras, at i-submit ang booking.',
        'tags': 'book,booking,session,reserve,how to',
    },
    {
        'id': 3,
        'question': 'What packages do you offer for photo studio?',
        'answer': 'We offer Studio Session packages for Solo, Couple, Friends, Family, and Birthday sessions, plus a Standard Event Package. Package details and prices are shown on the booking page.',
        'answer_tl': 'May Studio Session packages para sa Solo, Couple, Friends, Family, at Birthday sessions, pati Standard Event Package. Makikita ang detalye at presyo sa booking page.',
        'tags': 'packages,price,studio,solo,couple,friends,family,birthday,event',
    },
    {
        'id': 4,
        'question': 'Can we walk in for cafe or photo studio?',
        'answer': 'Cafe walk-ins are welcome. Studio walk-ins depend on room availability, so advance booking is recommended.',
        'answer_tl': 'Tumatanggap ng walk-in sa cafe. Depende sa availability ng room ang studio walk-in, kaya mas mainam ang advance booking.',
        'tags': 'walkin,walk-in,cafe,studio,drop in',
    },
    {
        'id': 5,
        'question': 'Where is CAV located?',
        'answer': STUDIO_ADDRESS,
        'answer_tl': STUDIO_ADDRESS,
        'tags': 'location,address,where,directions,saan,nasaan',
    },
    {
        'id': 6,
        'question': 'How do I reset my password?',
        'answer': 'Open the sign-in page, choose Forgot password, enter your registered email, verify the OTP, then set a new strong password.',
        'answer_tl': 'Buksan ang sign-in page, piliin ang Forgot password, ilagay ang registered email, i-verify ang OTP, at mag-set ng bagong matibay na password.',
        'tags': 'password,reset,forgot,otp,login,sign in',
    },
]
