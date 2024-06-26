#!/usr/bin/env node

const axios = require('axios')
const HtmlParser = require('node-html-parser')
const fs = require('fs')
const date = require('date-and-time')
const { program } = require('commander')

/**
 * @type { Map<string, string> }
 */
const globalCookieStore = new Map()

/**
 * Setup http client
 * withCredentials somehow not working. So please manage cookie by your self
 * 
 * @param {string} baseURL 
 * @returns {axios.Axios}
 */
async function init(baseURL) {
    const httpClient = new axios.Axios({
        baseURL,
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"
        },
        withCredentials: true,
    })

    const response = await httpClient.get("/")
    if (response.status != 200) {
        throw new Error(`Init failed! Server responsed a none 200 status code: ${response.status}. Response dumpped to: ${await dumpResponse(response)}`)
    }

    updateCoolkies(response)

    const tokenSearcher = /'X-CSRF-TOKEN': ?'(.+)'/g
    const [[_, token]] = response.data.matchAll(tokenSearcher)
    httpClient.defaults.headers["X-CSRF-TOKEN"] = token

    return httpClient
}

/**
 * 
 * @param { axios.Axios } httpClient 
 * @param { string } password
 * @param { string } username  
 * @returns { { userNumber: string } }
 */
async function login(httpClient, username, password) {
    const body = new FormData()
    body.append("login_user_name", username)
    body.append("login_password", password)
    body.append("login-submit", "Login")
    body.append("action", "login")

    let response = await httpClient.request({
        url: "/",
        method: 'POST',
        data: body,
        maxRedirects: 0,
        headers: {
            ...exportCookies()
        }
    })

    if (response.status != 302) {
        throw new Error(`Login failed #1! Server responsed a none 302 status code: ${response.status}. Check your password and try again later. Response dumpped to: ${await dumpResponse(response)}`)
    } 
    updateCoolkies(response)


    response = await httpClient.request({
        url: "/",
        method: "GET",
        headers: {
            ...exportCookies()
        }
    })

    if (response.status != 200) {
        throw new Error(`Login failed #2! Server responsed a none 200 status code: ${response.status}. Response dumpped to: ${await dumpResponse(response)}`)
    }
    updateCoolkies(response)


    const userNumberFinder = /<input ?type='hidden' ?name='user_num' ?id='user_num' ?value='([0-9]+)' ?\/>/g

    const result = "" + response.data
    const [[__, userNumber]] = result.matchAll(userNumberFinder)

    if (!userNumber) {
        throw new Error(`Login failed #3! Failed to search for token or userNumber. Response dumpped to: ${await dumpResponse(response)}`)
    }

    return { userNumber }
}

/**
 * 
 * @param {axios.Axios} httpClient 
 * @param {*} credentials 
 * @param {Date} d
 * @returns { { name: string, staffID: string, room: string }[] }
 */
async function fetchDataTable(httpClient, credentials, d) {
    const response = await httpClient.get("/ajax.DataTable.Fetch.php", {
        headers: {
            ...exportCookies()
        },
        params: {
            "table_name": "staff",
            "sequence_flag": "N",
            "action": "load-staff",
            "block_num": 1,
            "selected_date": date.format(d, "YYYY-MM-DD"),
            "user_num": credentials.userNumber,
            "_": Date.now()
        }
    })

    updateCoolkies(response)
    if (response.status != 200) {
        throw new Error(`fetchDataTable failed #1! Server responsed a none 302 status code: ${response.status}. Check your password and try again later. Response dumpped to: ${await dumpResponse(response)}`)
    } 

    let responseBody = "" + JSON.parse(response.data).content

    const begin = responseBody.indexOf("<tbody>")
    const end = responseBody.indexOf("</tbody>")
    responseBody = responseBody.substring(begin, end + 9) // </tbody> length + 1

    const html = HtmlParser.parse(responseBody, { lowerCaseTagName: true })
    const tBody = html.childNodes[0]

    const teachers = []
    
    // Lazy :P | If someday this stops working then I'll consider change this to resolve the DOM
    const roomNumberFinder = /<br ?\/?> ?-- ?([0-9a-zA-z]+)/g
    const teacherFinder = /<span id='name([0-9]+)'> ?([a-zA-z \-]+) ?<\/span>/g // Group1: StaffID, Group2: Name

    let errorTracker = ""
    for (const i of tBody.childNodes) {
        if (i instanceof HtmlParser.TextNode) {
            continue
        }
        const content = i.toString()
        try {
            const [[_, room]] = content.matchAll(roomNumberFinder)
            const [[__, staffID, name]] = content.matchAll(teacherFinder)
            teachers.push({ name, staffID, room })
        } catch (err) {
            errorTracker += "\n==========================\n"
            errorTracker += content
            errorTracker += "\n\nPROCESS ERROR\n"
        }
    }

    if (errorTracker.length > 0) {
        if (fs.existsSync("tableProcessError.report.txt")) {
            fs.rmSync("tableProcessError.report.txt")
        }
        fs.writeFileSync("tableProcessError.report.txt", errorTracker)

        console.log("Error: Failed to fully parse data table! Error dumped to: tableProcessError.report.txt")
    }

    return teachers
} 

/**
 * 
 * @param {axios.Axios} httpClient 
 * @param {*} credentials 
 * @param {'current' | 'nextweek'} week
 */
async function fetchAvailableDates(httpClient, credentials, week) {
    const response = await httpClient.get("/ajax.DataTable.Fetch.php", {
        headers: {
            ...exportCookies()
        },
        params: {
            "table_name": "plandates",
            "sequence_flag": "N",
            "action": "load-week",
            "block_num": 1,
            "selected_week_flag": week,
            "selected_user": credentials.userNumber,
            "_": Date.now()
        }
    })

    updateCoolkies(response)
    if (response.status != 200) {
        throw new Error(`fetchDataTable failed #1! Server responsed a none 302 status code: ${response.status}. Check your password and try again later. Response dumpped to: ${await dumpResponse(response)}`)
    } 
    const { content } = JSON.parse(response.data)
    if (!content) {
        throw new Error(`fetchDataTable failed #2! Illegal response data. Response dumpped to: ${await dumpResponse(response)}`)
    }
     
    const finder = /<td align='left' valign='top' class='(.+?)' onClick='' editable-by-student='([YN])' cell-date='([0-9]{4}-[0-9]{2}-[0-9]{2})' cell-block='([0-9])'/g

    // 0: <drop>
    // 1: flags (plan-day plan today datePlanComplete)
    // 2: editable-by-student (Y/N)
    // 3: date (yyyy-mm-dd)
    // 4: cell block (i guess useless)
    const matches = content.matchAll(finder)

    const avaDates = []
    for (const [_, flags, editable, date, block] of matches) {
        if (!flags.includes("datePlanComplete") && editable.startsWith("Y")) {
            avaDates.push(date)
        }
    }
    // TODO skip days that already been assigned.
    return avaDates
}

/**
 * 
 * @param {axios.Axios} httpClient 
 * @param {number} staffNumber
 * @param {Date} d
 * @returns {boolean}
 */
async function checkCapacity(httpClient, staffNumber, d) {
    const response = await httpClient.get("/ajax.checkStaffCapacity.php", {
        headers: {
            ...exportCookies()
        },
        params: {
            "block_num": 1,
            "plandate": date.format(d, "YYYY-MM-DD"),
            "staff_num": staffNumber,
            "_": Date.now()
        }
    })
    updateCoolkies(response)

    if (response.status != 200) {
        throw new Error(`checkCapacity failed #1! Server responsed a none 200 status code: ${response.status}. Check your password and try again later. Response dumpped to: ${await dumpResponse(response)}`)
    } 

    const { available } = JSON.parse(response.data)

    if (typeof available != 'number') {
        return available.parseInt(available) > 0
    } else {
        return available > 0
    }
}

/**
 * 
 * @param {axios.Axios} httpClient 
 * @param {number} staffNumber
 * @param {{ userNumber: string }} credentials
 * @param {string} plan 
 * @param {Date} d
 * @returns {boolean}
 */
async function savePlan(httpClient, staffNumber, { userNumber }, plan, d) {
    const response = await httpClient.get("/ajax.savePlan.php", {
        headers: {
            ...exportCookies()
        },
        params: {
            "plan_title": "",
            "plan": plan,
            "record_num": 0,
            "user_num": userNumber,
            "plandate": date.format(d, "YYYY-MM-DD"),
            "block_num": 1,
            "staff_num": staffNumber,
            "plan_type": "",
            "table_name": "dailyplan",
            "editable_by_student": "Y",
            "function": ""
        }
    })
    updateCoolkies(response)

    if (response.status != 200) {
        throw new Error(`savePlan failed #1! Server responsed a none 200 status code: ${response.status}. Check your password and try again later. Response dumpped to: ${await dumpResponse(response)}`)
    } 

    const { ajax_return_code, ajax_message } = JSON.parse(response.data)

    if (ajax_return_code == 1) {
        return { err: null }
    } else {
        return { err: ajax_message }
    }
}

/**
 * 
 * @param {string} token 
 * @param {string | number} target 
 * @param {string} profile
 * @param {"log" | "errorlog"} status 
 * @param {string | undefined | fs.PathLike} extramsg 
 */
async function tgNotify(token, target, profile, status, extramsg) {
    const http = new axios.Axios({
        baseURL: "https://api.telegram.org/bot" + token
    })

    if (status === 'errorlog') {
        const data = new FormData()
        data.append("document", new Blob([fs.readFileSync(extramsg)]), extramsg)
        const response = await http.post("/sendDocument", data, {
            params: {
                "chat_id": target
            },
            headers: {
                "Content-Type": "multipart/form-data"
            }
        })

        if (response.status != 200) {
            dumpResponse(response, "tglog.txt", true)
        }
    } else {
        const response = await http.post("/sendMessage", JSON.stringify({
            "chat_id": target,
            "parse_mode": "MarkdownV2",
            "text": `MyWeeklyPlanner\\-Auto Report [\`${status}\`] for \`${profile}\`\n\n \`` + (extramsg ?? "Nothing") + "\`"
        }), { headers: { "Content-Type": "application/json" }})

        if (response.status != 200) {
            dumpResponse(response, "tglog.txt", true)
        }
    }
}

/**
 * 
 * @param {axios.Axios} httpClient 
 */
async function logout(httpClient) {
    await httpClient.get("/", {
        headers: {
            ...exportCookies()
        },
        params: {
            "action": "logout"
        }
    })
}


/**
 * Dump axios response. Used to generate error report
 * 
 * @param {axios.AxiosResponse<any, any>} r 
 * @param {fs.PathLike} fn
 * @returns {fs.PathLike}
 */
async function dumpResponse(r, fn, notg) {
    let dump = `Request failed!\n`
    dump += `Status: ${r.status}(${r.statusText})`
    dump += "\n============== CONFIG ==============\n"
    try {
        dump += JSON.stringify(r.config, null, 4)
    } catch (err) {
        dump += "\n< FAIELD TO DUMP CONFIG >\n"
    }
    dump += "\n============== REQUEST ==============\n"
    dump += JSON.stringify(r.request.headers, null, 4)
    dump += "\n============== HEADER ==============\n"
    dump += JSON.stringify(r.headers, null, 4)
    dump += "\n============== BODY ==============\n"
    dump += r.data

    const fileName = fn ?? `${Date.now()}.requestdump.txt`

    if (fs.existsSync(fileName)) {
        fs.rmSync(fileName)
    }

    fs.writeFileSync(fileName, dump)

    if (!notg && tg) {
        await tgNotify(config.botToken, config.target, username, "errorlog", fileName)
    }

    return fileName
}

/**
 * 
 * @param {axios.AxiosResponse<any, any>} r 
 */
function updateCoolkies(r) {
    if (r.headers["set-cookie"]) {
        for (let i of r.headers["set-cookie"]) {
            const entries = i.split(";")
            for (let e of entries) {
                const [k, v] = e.split("=")
                if (!["path", "expires", "max-age"].includes(k.toLowerCase())) {
                    globalCookieStore.set(k, v)
                }
            }
        }
    }
}

function exportCookies() {
    let cookie = ""
    for (let i of globalCookieStore.keys()) {
        cookie += `${i}=${globalCookieStore.get(i)};`
    }

    if (cookie.length > 0) {
        cookie = cookie.substring(0, cookie.length - 2)
    }

    return { "Cookie": cookie }
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

Date.prototype.isLeapYear = function() {
    const year = this.getFullYear();
    if((year & 3) != 0) return false;
    return ((year % 100) != 0 || (year % 400) == 0);
};

// Get Day of Year
Date.prototype.getDOY = function() {
    const dayCount = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    const mn = this.getMonth();
    const dn = this.getDate();
    let dayOfYear = dayCount[mn] + dn;
    if(mn > 1 && this.isLeapYear()) dayOfYear++;
    return dayOfYear;
};

program
    .name("MyWeeklyPlanner Automation Script")
    .description("A tool for setting up plans in CLI")
    .version("1.1")

program
    .argument("<username>", "Username")
    .option("-g --genConfig", "Generate config for <user>")
    .option("-l --listTeachers", "List all available teachers")
    .option("-t --tg", "Send a notify in telegram")
    .option("-q --quiet", "Mute output")
    .option("-o --override", "Force override existing entries")
    .action(async (username, { tg, listTeachers, genConfig, quiet, override }) => {

        if (quiet) {
            console["log"] = () => void 0
        }

        if (!fs.existsSync(`${username}.config.json`)) {
            console.log("Please generate config first")
            process.exit(-1)
        }

        if (tg && (!config.botToken || !config.target)) {
            console.log("Error! Failed to remind via tg! Because no bot token or target was found!")
            process.exit(-1)
        }

        if (genConfig) {
            if (fs.existsSync(`${username}.config.json`)) {
                console.log("File exists!")
                process.exit(-1)
            }
        
            fs.writeFileSync(`${username}.config.json`, JSON.stringify({
                baseURL: "example.myweeklyplanner.net",
                username,
                password: "",
                botToken: "Optional",
                target: "", // ChannelUsername or UserID
                schedule: [
                    null, // sun
                    { // mon
                        selectionCandidate: {
                            room: "Required | Mon",
                            teacher: "OptionalTeacherName"
                        },
                        plan: ""
                    },
                    {
                        selectionCandidate: {
                            room: "Required | Tue",
                            teacher: "OptionalTeacherName"
                        },
                        plan: ""
                    },
                    null, // no fit on wed
                    {
                        selectionCandidate: {
                            room: "Required | Thu",
                            teacher: "OptionalTeacherName"
                        },
                        plan: ""
                    },
                    {
                        selectionCandidate: {
                            room: "Required | Fri",
                            teacher: "OptionalTeacherName"
                        },
                        plan: ""
                    },
                    null, // sat
                ],
            }, undefined, 4))
        
            process.exit(0)
        }

        /**
        * @type { { 
        *      baseURL: string,
        *      username: string,
        *      password: string,
        *      botToken: string | undefined | null,
        *      target: string | number | undefined | null,
        *      schedule: {
        *          selectionCandidate: {
        *              room: string | undefined | null,
        *              teacher: string | undefined | null,
        *          },
        *          plan: string
        *      }[]
        * } }
        */
       const config = JSON.parse(fs.readFileSync(`${username}.config.json`).toString())
        
        const http = await init(config.baseURL)
        const credentials = await login(http, config.username, config.password)
    
        const notAssignedDates = [
            ...(await fetchAvailableDates(http, credentials, 'current')),
            ...(await fetchAvailableDates(http, credentials, 'nextweek'))
        ]
    
        const today = new Date()
        const weekBegin = addDays(today, -today.getDay())
    
        for (let i = 0; i < 14; i ++) {
            const week = Math.floor(i / 7)
            const data = config.schedule[i - week * 7]
            if (!data) {
                console.log(`Skipping ${i}(DOW) becuase no data is present!`)
                continue
            }
    
            const goalDate = addDays(weekBegin, i)
            const standardDateStr = date.format(goalDate, "YYYY-MM-DD")
            if (goalDate.getDOY() < today.getDOY()) {
                console.log(`Skipping ${standardDateStr} because it was gone ~ Yes Forever ~ Can't be controlled like a river never stop`)
                continue
            }
    
            if (!override && !notAssignedDates.includes(standardDateStr)) {
                console.log(`Skipping ${standardDateStr} because you or sombody else already done the job. (hint: use --override)`)
                continue
            }
    
            try {
                const table = await fetchDataTable(http, credentials, goalDate)
    
                if (listTeachers) {
                    console.log(`At ${goalDate}`)
                    for (const j of table) {
                        console.log(`  ${j.name}(ID = ${j.staffID}) at ${j.room}`)
                    }
                    
                    break
                }
    
                if (!data.selectionCandidate || (!data.selectionCandidate.room && !data.selectionCandidate.teacher)) {
                    console.log("Error! No candicate is provided!")
                    process.exit(-1)
                }
    
                let staff = null
    
                if (data.selectionCandidate.room) {
                    for (const j of table) {
                        if (j.room == data.selectionCandidate.room) {
                            staff = j.staffID
                        }
                    }
                } else if (data.selectionCandidate.teacher) {
                    for (const j of table) {
                        if (j.name.includes(data.selectionCandidate.name)) {
                            staff = j.staffID
                        }
                    }
                }
    
                if (!staff) {
                    console.log("Error! No result was found with candidate: " + JSON.stringify(data.selectionCandidate) + " at: " + standardDateStr) 
                    continue 
                }
    
                if (!await checkCapacity(http, staff, goalDate)) {
                    console.log(`Skipping ${standardDateStr} because its full`)
                    continue
                }
    
                const { err } = await savePlan(http, staff, credentials, data.plan, goalDate)
                if (err) {
                    console.log(`Skipping ${standardDateStr} because server rejected with reason: ${err}`)
                    continue
                }
    
                console.log("Successfully setup plan on " + standardDateStr)
    
            } catch(err) {
                console.error(err)
            }
        }
        
        await logout(http)

        if (tg) {
            await tgNotify(config.botToken, config.target, config.username, "log", "Success")
        }
    
        console.log("Logged out successfully! Renew job done!")
    })

program.parse()