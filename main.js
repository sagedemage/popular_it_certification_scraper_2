import { chromium } from 'playwright'
import * as cheerio from 'cheerio';
import fs from 'node:fs';
import { spawnSync } from 'child_process';

function get_job_count_from_html_page(html_content) {
    let $ = cheerio.load(html_content);

    let total_jobs = 0
    let job_count_found = false

    // Check 1: Page contains the div tag of class table-counts
    let div_table_counts_tag = $('div.table-counts');
    if (div_table_counts_tag.length > 0) {
        let b_tag = div_table_counts_tag.find("b")

        for (let i = 0; i < b_tag.length; i++) {
            if (i === 1) {
                let text = b_tag.eq(i).text()
                total_jobs = parseInt(text)
                job_count_found = true
            }
        }
    } else {
        // Check 2: Page contains p tag of class showing-job-info
        let p_job_info_tag = $('p.showing-job-info');
        if (p_job_info_tag.length > 0) {
            let span_total_jobs_tag = p_job_info_tag.find("span.total-jobs")
            let text = span_total_jobs_tag.text().trim()
            total_jobs = parseInt(text)
            job_count_found = true
        } else {
            // Check 3: Page contains attribute data-testid="job-count"
            const job_count_element = $('[data-testid="job-count"]');
            if (job_count_element.length > 0) {
                let result = job_count_element.text()
                result = result.replace("jobs", "")
                result = result.trim()
                total_jobs = parseInt(result)
                job_count_found = true
            } else {
                // Check 4: Page contains the sapn tag of class result-count
                const result_count_element = $('span.result-count')
                if (result_count_element.length > 0) {
                    let result = result_count_element.text()
                    total_jobs = parseInt(result)
                    job_count_found = true
                } else {
                    // Check 5: Page contains the regex <num> results
                    const div = $('*:contains("results")');
                    if (div.length > 0) {
                        for (let i = 0; i < div.length; i++) {
                            let text = div.eq(i).text()
                            let match_result = text.match(/\d+ results/i)
                            if (match_result !== null) {
                                let result = match_result[0]
                                result = result.replace("results", "")
                                result = result.trim()
                                total_jobs = parseInt(result)
                                job_count_found = true
                                break
                            }
                        }
                    }
                }
            }
        }
    }

    if (job_count_found === false) {
        throw new Error("Job count is not found!");
    }

    return total_jobs
}

async function main() {
    const chrome_browser_version = get_chrome_browser_version()
    const user_agent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome_browser_version} Safari/537.36`
    const browser_options = {
        args: [
            `--user-agent=${user_agent}`,
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080',
            '--window-position=0,0',
            '--disable-extensions',
            '--disable-sync',
            '--disable-default-apps'
        ],
        ignoreDefaultArgs: ['--mute-audio'],
        headless: false
    }
    const browser = await chromium.launch(browser_options);

    const context_options = { viewport: null }
    const context = await browser.newContext(context_options);

    // set navigator.webdriver to undefined to remove automation indicators
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined
        });
        window.chrome = {
            runtime: {}
        };
    });

    const page = await context.newPage();

    const it_certs = ["Comptia Network+", "CCNA", "Comptia Security+"] 

    const company_career_urls = [
        "https://www.lockheedmartinjobs.com/search-jobs/",
        "https://careers.rtx.com/global/en/search-results?keywords=",
        "https://jobs.northropgrumman.com/careers?query=",
        "https://www.gdit.com/careers/search/?q=",
        "https://jobs.baesystems.com/global/en/search-results?keywords="
    ]

    let url_infos = []

    for (const it_cert of it_certs) {
        for (const company_career_url of company_career_urls) {
            const search_query = encodeURIComponent(it_cert)
            let url = company_career_url + search_query
            const url_info = {"url": url, "it_cert": it_cert}
            url_infos.push(url_info)
        }
    }

    let data = {}
    for (const it_cert of it_certs) {
        data[it_cert] = []
    }

    for (const url_info of url_infos) {
        let url = url_info.url
        let it_cert = url_info.it_cert

        await page.goto(url);
        await page.waitForTimeout(2*1000)

        let title = await page.title()

        if (title === "Just a moment...") {
            await page.waitForTimeout(8*1000)
        }

        let html_content = await page.content()

        let total_jobs = get_job_count_from_html_page(html_content)

        data[it_cert].push(total_jobs)
    }

    await context.close()
    await browser.close()

    let json_data_file_path = "data/results.json"
    fs.writeFile(json_data_file_path, JSON.stringify(data, null, 2), err => {
        if (err) {
            console.error(err)
        } else {
            // file written sucessfully
            console.log("JSON Data written to", json_data_file_path)
        }
    });

    let avgs = []
    let it_cert_avgs = {}

    for (const it_cert of it_certs) {
        let avg = average(data[it_cert])
        avg = round(avg, 0)
        avgs.push(avg)
        it_cert_avgs[it_cert] = avg
        
    }

    avgs = reverse_sort_list_of_nums(avgs)

    let content = ""
    for (const avg of avgs) {
        for (const it_cert of it_certs) {
            if (it_cert_avgs[it_cert] === avg) {
                let avg_line = `Average of ${it_cert}: ${avg}\n`
                content += avg_line
                break
            }
        }
    }

    let avg_data_file_path = "data/it_cert_averages.txt"
    fs.writeFile(avg_data_file_path, content, err => {
        if (err) {
            console.error(err);
        } else {
            // file written successfully
            console.log("IT cert averages data written to", avg_data_file_path)
        }
    });
}

function round(num, dec_places) {
    const r_value = Math.pow(10, dec_places)
    const rounded_num = Math.round(num * r_value) / r_value
    return rounded_num
}

function average(num_array) {
    let sum = 0
    for (const num of num_array) {
        sum += num
    }

    const avg = sum / num_array.length
    return avg
}

function reverse_sort_list_of_nums(list_of_nums) {
    const descending = list_of_nums.sort((a, b) => b - a);
    return descending
}

function get_chrome_browser_version() {
    const cmd = "(Get-Item \"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\").VersionInfo.FileVersion"
    let process = spawnSync("powershell.exe", [cmd])
    const output = process.stdout.toString()

    const version_elements = output.split(".")
    const major_version = version_elements[0]
    const chrome_browser_version = `${major_version}.0.0.0`

    return chrome_browser_version
};

main()
