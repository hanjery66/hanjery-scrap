import { z } from "zod";

export const lotteryResultScalpSchema = z.object({
    date: z.coerce.date(),
    result_url: z.string().optional(),
    column: z.enum(["V1", "V2", "V3"]),
    isNight: z.boolean(),
    isVn: z.boolean()
})